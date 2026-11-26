import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { fetchJson } from './http';
import { isModelHoliday } from './model-calendar';
import type { Forecast } from './types';
import { runForecastInput } from './onnx-forecast';

const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric',weekday:'short',hour:'numeric',hourCycle:'h23',timeZoneName:'longOffset'});
const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const weatherKeys=['temperature_2m','precipitation','snowfall','wind_speed_10m'] as const;
type Weather=Record<typeof weatherKeys[number],number[]> & {time:number[]};
type Scaling=Record<typeof weatherKeys[number],{mean:number;std:number}>;
const profileSchema=z.object({source:z.string(),reference_end:z.string(),source_months:z.array(z.number().int()).optional(),zone_ids:z.array(z.number().int()).length(263),rows:z.array(z.array(z.number().nonnegative().finite()).length(263)).length(168)});
const scale=z.object({mean:z.number().finite(),std:z.number().finite().positive()});
const scalingSchema=z.object({temperature_2m:scale,precipitation:scale,snowfall:scale,wind_speed_10m:scale});

function parts(at:number){return Object.fromEntries(clock.formatToParts(new Date(at)).map(part=>[part.type,part.value]));}
export function buildEstimateInputs(origin:number,profile:number[][],weather:Weather,scaling:Scaling){
  const demand:number[][]=[],context:number[][]=[];
  for(let index=0;index<168;index++){
    const at=origin-(167-index)*3600000,p=parts(at),dow=days.indexOf(p.weekday),hour=Number(p.hour);
    const weatherIndex=weather.time.indexOf(at/1000);
    if(dow<0||weatherIndex<0)throw Error('Recent weather does not cover the model history.');
    const wx=weatherKeys.map(key=>weather[key][weatherIndex]);
    if(wx.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw Error('Recent weather contains missing values.');
    const holiday=(delta:number)=>{const d=new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)+delta,12));return Number(isModelHoliday(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()));};
    demand.push(profile[dow*24+hour]);
    context.push([Math.sin(2*Math.PI*hour/24),Math.cos(2*Math.PI*hour/24),Math.sin(2*Math.PI*dow/7),Math.cos(2*Math.PI*dow/7),
      Number(dow>=5),holiday(0),holiday(1),holiday(-1),Number(p.timeZoneName!==parts(at-3600000).timeZoneName),
      ...weatherKeys.map((key,i)=>(wx[i]-scaling[key].mean)/scaling[key].std),Number(wx[1]>0.1)]);
  }
  return {origin:new Date(origin).toISOString(),demand,context};
}
let cached:{hour:number;expires:number;promise:Promise<Forecast>}|undefined;
export function getCurrentEstimate(now=Date.now()):Promise<Forecast>{
  // All pickup inputs are estimates, including the in-progress current hour.
  // Origin is its START label; +h then aligns with the departure's target hour.
  const origin=Math.floor(now/3600000)*3600000;
  if(cached&&cached.hour===origin&&cached.expires>now)return cached.promise;
  const promise=(async()=>{
    const directory=join(process.cwd(),'model');
    const profile=profileSchema.parse(JSON.parse(await readFile(join(directory,'reference-profile.json'),'utf8')));
    const metadata=JSON.parse(await readFile(join(directory,'metadata.json'),'utf8'));
    if(JSON.stringify(profile.zone_ids)!==JSON.stringify(metadata.zones.map((zone:{id:number})=>zone.id)))throw Error('Reference profile has a different zone order.');
    const prep=JSON.parse(await readFile(join(directory,'preprocessing.json'),'utf8'));
    const scaling=scalingSchema.parse(prep.weather_scaling);
    const url=new URL(process.env.OPEN_METEO_API_KEY?'https://customer-api.open-meteo.com/v1/forecast':'https://api.open-meteo.com/v1/forecast');
    url.search=new URLSearchParams({latitude:'40.7128',longitude:'-74.006',hourly:weatherKeys.join(','),past_days:'8',forecast_days:'1',
      timeformat:'unixtime',timezone:'UTC',temperature_unit:'celsius',precipitation_unit:'mm',wind_speed_unit:'kmh',
      ...(process.env.OPEN_METEO_API_KEY?{apikey:process.env.OPEN_METEO_API_KEY}:{})}).toString();
    const raw=z.object({hourly_units:z.object({temperature_2m:z.literal('°C'),precipitation:z.literal('mm'),snowfall:z.literal('cm'),wind_speed_10m:z.literal('km/h')}),
      hourly:z.object({time:z.array(z.number().int()),temperature_2m:z.array(z.number().nullable()),precipitation:z.array(z.number().nullable()),
        snowfall:z.array(z.number().nullable()),wind_speed_10m:z.array(z.number().nullable())})}).parse(await fetchJson(url.toString(),{},200_000,8000));
    if(Object.values(raw.hourly).some(values=>values.length!==raw.hourly.time.length)||new Set(raw.hourly.time).size!==raw.hourly.time.length)throw Error('Invalid recent weather grid');
    const inputs=buildEstimateInputs(origin,profile.rows,raw.hourly as Weather,scaling);
    return runForecastInput(inputs,'estimate',`Estimated pickup history from ${profile.source}; reference ends ${profile.reference_end}. Recent weather: Open-Meteo.`,
      'Current-date demand estimate from a historical weekly reference profile and recent weather. No current pickup observations are connected. '+
      (profile.source_months?`The reference spans ${profile.source_months.length} calendar months. `:'The bundled profile covers one reference week. ')+
      'Accuracy is not established for current conditions.');
  })();
  cached={hour:origin,expires:now+10*60_000,promise};
  void promise.catch(()=>{if(cached?.promise===promise)cached=undefined;});
  return promise;
}
