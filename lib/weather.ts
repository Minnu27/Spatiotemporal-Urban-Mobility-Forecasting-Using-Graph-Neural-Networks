import { z } from 'zod';
import { fetchJson } from './http';
import type { Zone } from './types';

export const weatherSource = 'https://open-meteo.com/';
const numbers = (min: number, max: number) => z.array(z.number().finite().min(min).max(max).nullable());
const schema = z.object({
  hourly_units: z.object({temperature_2m:z.literal('°C'),precipitation:z.literal('mm'),snowfall:z.literal('cm'),wind_speed_10m:z.literal('km/h')}),
  hourly: z.object({
    time: z.array(z.number().int().positive()).min(2).max(400),
    temperature_2m: numbers(-90,65), precipitation: numbers(0,500),
    snowfall: numbers(0,200), wind_speed_10m: numbers(0,500),
    weather_code: numbers(0,99),
  }),
});
type Hourly = z.infer<typeof schema>['hourly'];
type Cached = { expires: number; fetchedAt: string; hourly: Hourly };
// Best-effort short cache; no personal coordinates are accepted from the browser.
const cache = new Map<number, Promise<Cached>>();
const labels: Record<number,string> = {
  0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',
  51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',56:'Freezing drizzle',57:'Freezing drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
  80:'Rain showers',81:'Rain showers',82:'Heavy showers',85:'Snow showers',86:'Heavy snow showers',
  95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with hail',
};
export type WeatherHour = {
  zoneId:number; zone:string; at:string; fetchedAt:string;
  temperatureC:number; precipitationMm:number; snowfallCm:number; windKph:number; code:number; condition:string;
};
export type TripWeather = {
  state:'forecast'|'partial'|'unavailable'; departure:string; source:string;
  pickup:WeatherHour|null; dropoff:WeatherHour|null;
};

export function selectWeatherHour(hourly: Hourly, zone: Zone, departure: number, fetchedAt: string): WeatherHour | null {
  const index = hourly.time.findIndex(time => time * 1000 <= departure && departure < (time + 3600) * 1000);
  if (index < 0) return null;
  const values = [hourly.temperature_2m[index],hourly.precipitation[index],hourly.snowfall[index],hourly.wind_speed_10m[index],hourly.weather_code[index]];
  if (values.some(value=>value === null || value === undefined || !Number.isFinite(value))) return null;
  const [temperatureC,precipitationMm,snowfallCm,windKph,code] = values as number[];
  return {zoneId:zone.id,zone:zone.name,at:new Date(hourly.time[index]*1000).toISOString(),fetchedAt,
    temperatureC,precipitationMm,snowfallCm,windKph,code,condition:labels[code] || 'Other conditions'};
}

async function hourlyWeather(zone: Zone, now: number): Promise<Cached> {
  const existing = cache.get(zone.id);
  if (existing) {
    try { const value=await existing; if(value.expires>now)return value; } catch { /* retry a failed fetch */ }
    cache.delete(zone.id);
  }
  const pending = (async () => {
    const key=process.env.OPEN_METEO_API_KEY?.trim();
    const url=new URL(key?'https://customer-api.open-meteo.com/v1/forecast':'https://api.open-meteo.com/v1/forecast');
    url.search=new URLSearchParams({latitude:String(zone.latitude),longitude:String(zone.longitude),
      hourly:'temperature_2m,precipitation,snowfall,wind_speed_10m,weather_code',
      timezone:'UTC',timeformat:'unixtime',forecast_days:'3',temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm',
      ...(key?{apikey:key}:{}),
    }).toString();
    const {hourly}=schema.parse(await fetchJson(url.toString(),{},100_000,5000));
    if(Object.values(hourly).some(values=>values.length!==hourly.time.length) ||
      hourly.time.some((time,index)=>index>0&&time-hourly.time[index-1]!==3600)) throw Error('Invalid hourly weather grid');
    return {hourly,fetchedAt:new Date(now).toISOString(),expires:now+10*60_000};
  })();
  if(cache.size>=64)cache.delete(cache.keys().next().value!);
  cache.set(zone.id,pending);
  try{return await pending;}catch(error){if(cache.get(zone.id)===pending)cache.delete(zone.id);throw error;}
}

export async function getTripWeather(from: Zone, to: Zone, departure: number, now=Date.now()): Promise<TripWeather> {
  const results=await Promise.allSettled([from,to].map(async zone=>{
    const result=await hourlyWeather(zone,now);
    return selectWeatherHour(result.hourly,zone,departure,result.fetchedAt);
  }));
  const [pickup,dropoff]=results.map(result=>result.status==='fulfilled'?result.value:null);
  return {state:pickup&&dropoff?'forecast':pickup||dropoff?'partial':'unavailable',departure:new Date(departure).toISOString(),source:weatherSource,pickup,dropoff};
}
