import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTripWeather, selectWeatherHour, type TripWeather } from '../lib/weather';
import { weatherImpact } from '../lib/weather-impact';
import { planTrip, slowRoute } from '../lib/trip-planning';
import { calculateQuote, findTrip, quoteInput, type RouteEstimate } from '../lib/trip-fare';
import { POST } from '../app/api/fare/route';

const from=findTrip(161,132)!.from,to=findTrip(161,132)!.to;
const stamp=Date.parse('2026-12-01T15:00:00Z');
function fixture(origin:number,code=65) {
 const time=Array.from({length:72},(_,i)=>origin/1000+i*3600);
 return {hourly_units:{temperature_2m:'°C',precipitation:'mm',snowfall:'cm',wind_speed_10m:'km/h'},hourly:{
  time,temperature_2m:time.map(()=>8),precipitation:time.map(()=>code===0?0:3),
  snowfall:time.map(()=>0),wind_speed_10m:time.map(()=>10),weather_code:time.map(()=>code),
 }};
}
const route:RouteEstimate={milesAbove12mph:0,slowMinutes:30,miles:5,minutes:30,south96:true,south60:true,
 steps:[],segments:[{meters:5*1609.344,seconds:30*60}],traffic:'departure-time'};

test('hourly weather selects the departure hour across midnight and never substitutes a missing or null hour',()=>{
 const {hourly}=fixture(stamp);
 const weather=selectWeatherHour(hourly,from,stamp+24*3600000+1234,new Date(stamp).toISOString());
 assert.equal(weather?.at,'2026-12-02T15:00:00.000Z');
 assert.equal(selectWeatherHour(hourly,from,stamp-1,''),null);
 const missing={...hourly,temperature_2m:hourly.temperature_2m.map((value,index)=>index===24?null:value)};
 assert.equal(selectWeatherHour(missing,from,stamp+24*3600000,''),null);
});

test('weather feeds the travel-time sensitivity model and regulated meter, while flat fares stay fixed',async context=>{
 context.mock.method(globalThis,'fetch',async(input:string)=>{
  const url=new URL(input);assert.equal(url.hostname,'api.open-meteo.com');
  assert.equal(url.searchParams.get('timeformat'),'unixtime');
  assert.equal(url.searchParams.get('wind_speed_unit'),'kmh');
  return Response.json(fixture(stamp));
 });
 const trip=findTrip(161,138)!;
 const input=quoteInput.parse({pickup:161,dropoff:138,horizon:3});
 const result=await planTrip(input,trip,route,stamp);
 assert.equal(result.weather.state,'forecast');assert.equal(result.weather.pickup?.at,'2026-12-01T18:00:00.000Z');
 assert.equal(result.weatherAdjustment.kind,'scenario');assert.equal(result.weatherAdjustment.state,'applied');
 assert.ok(result.planningMaximum>result.total);
 assert.ok(result.weatherAdjustment.minutesMaximum!>route.minutes);
 assert.equal(result.planningMinimum,result.total);
 const flat=await planTrip(quoteInput.parse({pickup:161,dropoff:132,horizon:3}),findTrip(161,132)!,route,stamp);
 assert.equal(flat.planningMinimum,flat.total);assert.equal(flat.planningMaximum,flat.total);
 assert.ok(flat.weatherAdjustment.minutesMaximum!>route.minutes);
 assert.equal(flat.breakdown.find(charge=>charge.label==='JFK–Manhattan flat fare')?.amount,70);
});

test('weather failure preserves the fare without fabricating conditions or a weather premium',async context=>{
 const now=stamp+2*86400000;
 context.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
 const input=quoteInput.parse({pickup:161,dropoff:138,horizon:12});
 const result=await planTrip(input,findTrip(161,138)!,route,now);
 assert.equal(result.weather.state,'unavailable');assert.equal(result.weather.pickup,null);
 assert.equal(result.weatherAdjustment.state,'unavailable');
 assert.equal(result.total,calculateQuote(input,findTrip(161,138)!,route,now).total);
 assert.equal(result.planningMaximum,result.maximum);
});

test('partial weather, unsupported icy conditions and dry conditions remain distinct',()=>{
 const hour=selectWeatherHour(fixture(stamp,0).hourly,from,stamp,'')!;
 const weather:TripWeather={state:'forecast',departure:new Date(stamp).toISOString(),source:'https://open-meteo.com/',pickup:hour,dropoff:hour};
 assert.deepEqual(weatherImpact(weather).speedReduction,[0,0]);
 assert.equal(weatherImpact({...weather,dropoff:null,state:'partial'}).state,'unavailable');
 assert.equal(weatherImpact({...weather,pickup:{...hour,code:67}}).state,'unsupported');
 assert.throws(()=>slowRoute(route,1));
 assert.throws(()=>slowRoute({...route,segments:undefined},0.1));
});

test('weather route speed loss recalculates the 12 mph meter boundary instead of multiplying the fare',()=>{
 const fast={...route,milesAbove12mph:1,slowMinutes:0,miles:1,minutes:4,segments:[{meters:1609.344,seconds:240}]};
 const adjusted=slowRoute(fast,0.25);
 assert.equal(adjusted.miles,1);assert.equal(adjusted.milesAbove12mph,0);
 assert.ok(Math.abs(adjusted.slowMinutes-320/60)<1e-8);
});

test('fare endpoint sends the selected departure to routing and weather, and rejects unsupported hours',async context=>{
 const now=stamp+4*86400000;
 context.mock.method(Date,'now',()=>now);
 const oldMapbox=process.env.MAPBOX_ACCESS_TOKEN,oldOsrm=process.env.ROUTING_SERVICE_URL;
 process.env.MAPBOX_ACCESS_TOKEN='pk.test';delete process.env.ROUTING_SERVICE_URL;
 let routingDeparture='';
 context.mock.method(globalThis,'fetch',async(input:string)=>{
  const url=new URL(input);
  if(url.hostname.endsWith('open-meteo.com'))return Response.json(fixture(now,61));
  assert.equal(url.hostname,'api.mapbox.com');routingDeparture=url.searchParams.get('depart_at')!;
  assert.match(url.pathname,/driving-traffic/);
  return Response.json({code:'Ok',routes:[{distance:5*1609.344,duration:1800,geometry:{coordinates:[[-73.98,40.75],[-73.89,40.77]]},
   legs:[{steps:[],annotation:{distance:[5*1609.344],duration:[1800]}}]}]});
 });
 try{
  const response=await POST(new Request('https://urbanflow.example/api/fare',{method:'POST',body:JSON.stringify({pickup:161,dropoff:138,horizon:24})}));
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(Date.parse(routingDeparture),now+24*3600000);
  assert.equal(data.departure,data.weather.departure);assert.equal(data.weather.state,'forecast');
  assert.equal(Date.parse(data.weather.pickup.at),now+24*3600000);
  assert.ok(data.planningMaximum>data.total);
  const invalid=await POST(new Request('https://urbanflow.example/api/fare',{method:'POST',body:JSON.stringify({pickup:161,dropoff:138,horizon:2})}));
  assert.equal(invalid.status,400);
 }finally{
  if(oldMapbox===undefined)delete process.env.MAPBOX_ACCESS_TOKEN;else process.env.MAPBOX_ACCESS_TOKEN=oldMapbox;
  if(oldOsrm===undefined)delete process.env.ROUTING_SERVICE_URL;else process.env.ROUTING_SERVICE_URL=oldOsrm;
 }
});

test('invalid weather units never turn into a weather price adjustment',async context=>{
 const now=stamp+6*86400000;
 context.mock.method(globalThis,'fetch',async()=>Response.json({...fixture(now),hourly_units:{temperature_2m:'°F',precipitation:'inch',snowfall:'inch',wind_speed_10m:'mph'}}));
 assert.equal((await getTripWeather(from,to,now,now)).state,'unavailable');
});
