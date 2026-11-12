import type { Incident, Impact, Zone } from './types';
export function distanceKm(a: Pick<Zone,'latitude'|'longitude'>, b: Pick<Zone,'latitude'|'longitude'>): number {
  const rad = Math.PI/180, dLat=(b.latitude-a.latitude)*rad, dLon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function estimateImpact(zones: Zone[], incidents: Incident[]): Impact[] {
  // Transparent distance-decay heuristic, NOT a trained closure or demand prediction.
  // Geographic propagation is confined to nearby zones; unlocated alerts remain network notices.
  return zones.map(zone=> {
    const matches=incidents.flatMap(i=> {
      if (i.latitude===null || i.longitude===null) return [];
      const km=distanceKm(zone,{latitude:i.latitude,longitude:i.longitude});
      if (km>2.5) return [];
      return [{incident:i,weight:({low:0.2,moderate:0.45,high:0.8}[i.severity])*Math.exp(-km/0.8)}];
    });
    const score=Math.round(100*(1-matches.reduce((p,m)=>p*(1-m.weight),1)));
    return {zoneId:zone.id,score,level:score>=60?'high':score>=25?'moderate':'low',incidentIds:matches.map(m=>m.incident.id),
      explanation:matches.length ? `${matches.length} nearby reports within 2.5 km. Distance-decay scenario score; not a probability or trained demand adjustment.` : 'No geolocated reports within 2.5 km. Unlocated subway alerts are shown separately; low score does not establish normal service.'};
  });
}
