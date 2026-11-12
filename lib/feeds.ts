import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { z } from 'zod';
import { fetchBounded, fetchJson, serverUrl } from './http';
import type { AlertResult, FeedStatus, Incident } from './types';
const NYC = 'https://data.cityofnewyork.us/resource/i6b5-j7bu.json';
const MTA = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts';
const boroughs: Record<string, string> = { M:'Manhattan', B:'Brooklyn', K:'Brooklyn', Q:'Queens', X:'Bronx', S:'Staten Island' };
export const citizenSchema = z.object({ incidents: z.array(z.object({
  id: z.string().min(1).max(200), title: z.string().min(1).max(300), description: z.string().max(3000),
  kind: z.enum(['road','subway']), borough: z.string().max(80), severity: z.enum(['low','moderate','high']),
  start: z.iso.datetime({offset:true}).nullable(), end: z.iso.datetime({offset:true}).nullable(),
  latitude: z.number().min(40.45).max(41).nullable(), longitude: z.number().min(-74.3).max(-73.65).nullable(),
  routes: z.array(z.string().max(20)).max(50).default([]), url: z.url().refine(v => v.startsWith('https://')),
})).max(500) });
export function normalizeCitizen(input: unknown, now: string): Incident[] {
  return citizenSchema.parse(input).incidents.map(v => ({...v, id:`citizen:${v.id}`, source:'Citizen', fetchedAt:now}));
}
export function normalizeRoads(rows: unknown, now: string): Incident[] {
  if (!Array.isArray(rows)) throw new Error('Unexpected NYC DOT feed');
  return rows.map((r, i) => {
    const point = r.the_geom?.coordinates?.[0]?.[0];
    return { id:`dot:${r.uniqueid ?? i}`, source:'NYC DOT' as const, title:`${r.onstreetname || 'Street'} · planned work`,
      description:`${r.fromstreetname || ''} to ${r.tostreetname || ''}. ${r.purpose || 'Construction activity'}. A work permit does not confirm a full road closure.`,
      kind:'road' as const, borough:boroughs[r.borough_code] ?? 'Unknown', severity:'moderate' as const,
      start:r.work_start_date ? `${r.work_start_date.slice(0,10)}` : null, end:r.work_end_date ? `${r.work_end_date.slice(0,10)}` : null,
      longitude:typeof point?.[0] === 'number' ? point[0] : null, latitude:typeof point?.[1] === 'number' ? point[1] : null,
      routes:[], url:'https://data.cityofnewyork.us/Transportation/i6b5-j7bu', fetchedAt:now };
  });
}
export function normalizeMta(bytes: Uint8Array, now: string): Incident[] {
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const text = (v: {translation?: readonly {text?: string | null}[] | null} | null | undefined) => (v?.translation?.find(t => t.text)?.text ?? '').replace(/<[^>]*>/g, '').slice(0,3000);
  const epoch = Date.parse(now)/1000;
  return (feed.entity ?? []).flatMap(entity => {
    const a = entity.alert; if (!a) return [];
    const periods = a.activePeriod ?? [];
    if (periods.length && !periods.some(p => (!Number(p.start) || Number(p.start) <= epoch) && (!Number(p.end) || Number(p.end) > epoch))) return [];
    const routes = [...new Set((a.informedEntity ?? []).map(e=>e.routeId).filter((v): v is string => !!v))];
    // This dashboard covers subway only; discard bus/rail alerts from all-alerts.
    const subway = new Set(['1','2','3','4','5','6','6X','7','7X','A','B','C','D','E','F','FX','G','J','L','M','N','Q','R','S','SI','W','Z']);
    if (!routes.some(r=>subway.has(r))) return [];
    const active = periods.find(p => (!Number(p.start) || Number(p.start) <= epoch) && (!Number(p.end) || Number(p.end) > epoch));
    const date = (v: unknown) => Number(v) ? new Date(Number(v)*1000).toISOString() : null;
    return [{ id:`mta:${entity.id}`, source:'MTA' as const, title:text(a.headerText) || 'Subway service alert', description:text(a.descriptionText),
      kind:'subway' as const, borough:'Network-wide', severity:a.effect === 1 ? 'high' as const : 'moderate' as const,
      start:date(active?.start), end:date(active?.end), latitude:null, longitude:null, routes,
      url:'https://www.mta.info/alerts', fetchedAt:now }];
  });
}
let cache: {expires:number; value:AlertResult} | undefined;
export async function getAlerts(force = false): Promise<AlertResult> {
  if (!force && cache && cache.expires > Date.now()) return cache.value;
  const now = new Date().toISOString();
  // NYC local date, not the server's UTC date, for local permit dates.
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const query = new URLSearchParams({'$where':`work_start_date <= '${day}T23:59:59' AND work_end_date >= '${day}T00:00:00'`,'$limit':'300','$order':'work_start_date DESC'});
  const sources = [
    {source:'NYC DOT', run:async()=>normalizeRoads(await fetchJson(`${NYC}?${query}`),now)},
    {source:'MTA', run:async()=>normalizeMta(await fetchBounded(MTA,{},5_000_000),now)},
    {source:'Citizen', run:async()=> {
      if (!process.env.CITIZEN_FEED_URL) return null;
      return normalizeCitizen(await fetchJson(serverUrl(process.env.CITIZEN_FEED_URL), {headers:process.env.CITIZEN_API_KEY ? {Authorization:`Bearer ${process.env.CITIZEN_API_KEY}`} : {}}),now)
        .filter(i=>(!i.start || Date.parse(i.start)<=Date.parse(now)) && (!i.end || Date.parse(i.end)>Date.parse(now)));
    }},
  ];
  const results = await Promise.allSettled(sources.map(s=>s.run()));
  const incidents: Incident[] = []; const feeds: FeedStatus[] = [];
  results.forEach((r,i)=> {
    const source=sources[i].source;
    if (r.status==='fulfilled' && r.value !== null) { incidents.push(...r.value); feeds.push({source,state:'live',detail:source==='NYC DOT'?'Active planned work permits; up to 300 records.':'Current service reports.',fetchedAt:now}); }
    else feeds.push({source,state:r.status==='fulfilled'?'not_configured':'unavailable',detail:r.status==='fulfilled'?'Authorized feed endpoint required.':'Source could not be reached or parsed. Retry later.',fetchedAt:now});
  });
  const unique=[...new Map(incidents.map(v=>[v.id,v])).values()];
  const value={incidents:unique,feeds,fetchedAt:now}; cache={expires:Date.now()+60_000,value}; return value;
}
