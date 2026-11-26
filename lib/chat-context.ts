import {getAlerts} from './feeds';
import {getForecast} from './forecast';
import {getTripWeather} from './weather';
import {contextualQuery,needsLiveAlerts,corpus,retrieve} from './rag';
import zones from '@/data/zones.json';
import type {AlertResult,Document} from './types';
type Demand={zoneId:number;horizon:1|3|6|12|24};
export async function chatContext(question:string,history:{role:string;body:string}[],demand?:Demand){
 const query=contextualQuery(question,history),now=Date.now();
 const findZone=(text:string)=>zones.filter(zone=>text.toLowerCase().includes(zone.name.toLowerCase())).sort((a,b)=>b.name.length-a.name.length)[0];
 const zone=findZone(question)||findZone(query);
 const hourPattern=/\b(1|3|6|12|24)\s*(?:h\b|hours?\b|hrs?\b)/i;
 const hour=question.match(hourPattern)||query.match(hourPattern);
 if(!demand&&zone&&hour&&/\b(demand|pickups?|forecast|predict|estimate)\b/i.test(query))demand={zoneId:zone.id,horizon:Number(hour[1]) as Demand['horizon']};
 const structured:Document[]=[];
 const tasks=[
  needsLiveAlerts(query)?getAlerts():Promise.resolve<AlertResult>({incidents:[],feeds:[],fetchedAt:new Date(now).toISOString()}),
  /\b(weather|temperature|rain|raining|snow|wind|sunny)\b/i.test(query)?(async()=>{
   const location=zone||zones.find(zone=>zone.id===161)!;
   const departure=now+Number(hour?.[1]||0)*3600000;
   const weather=await getTripWeather(location,location,departure,now);
   structured.push({id:'weather-context',title:`Weather forecast · ${location.name}, NYC`,text:JSON.stringify({location:location.name,departure:weather.departure,state:weather.state,weather:weather.pickup,
    qualification:'NYC zone forecast, not an observation or a forecast for another city. Missing weather is unavailable.'}),url:weather.source,kind:'weather'});
  })():Promise.resolve(),
  demand?(async()=>{
   const forecast=await getForecast(),row=forecast.rows.find(row=>row.zoneId===demand!.zoneId&&row.horizon===demand!.horizon);
   structured.push({id:'demand-context',title:'Current structured demand context',kind:'forecast',url:'/api/forecast',
    text:JSON.stringify({zone:zones.find(zone=>zone.id===demand!.zoneId)?.name,horizon:demand!.horizon,mode:forecast.mode,origin:forecast.issuedAt,
     target:new Date(Date.parse(forecast.issuedAt)+demand!.horizon*3600000).toISOString(),pickups:row?.value??null,source:forecast.historySource,message:forecast.message})});
  })():Promise.resolve(),
 ] as const;
 const [alerts]=await Promise.all(tasks);
 // Structured results always precede textual methodology. A specific route's
 // alert can still rank independently of the compact citywide summary.
 structured.sort((a,b)=>a.id==='demand-context'?-1:b.id==='demand-context'?1:0);
 return {structured,publicDocs:retrieve(query,corpus(alerts)),fetchedAt:alerts.fetchedAt,query};
}
