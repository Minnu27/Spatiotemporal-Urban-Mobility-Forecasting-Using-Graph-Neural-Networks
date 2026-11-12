import { test } from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { normalizeCitizen, normalizeMta, normalizeRoads } from '../lib/feeds';
import { estimateImpact } from '../lib/impact';
import { estimateFare } from '../lib/fares';
import { retrieve } from '../lib/rag';
import type { Document, Incident, Zone } from '../lib/types';
const now='2026-11-11T18:00:00Z';
test('MTA includes only alerts active now, and only subway routes',()=>{
 const seconds=Date.parse(now)/1000;
 const entity=(id:string,start:number,end:number,route:string)=>({id,alert:{activePeriod:[{start,end}],headerText:{translation:[{text:`Alert ${id}`,language:'en'}]},informedEntity:[{routeId:route}],effect:1}});
 const bytes=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:Date.parse(now)/1000},entity:[entity('active',seconds-60,seconds+60,'A'),entity('future',seconds+60,seconds+120,'A'),entity('past',seconds-120,seconds-1,'A'),entity('bus',seconds-60,seconds+60,'M15')]}).finish();
 const result=normalizeMta(bytes,now);assert.equal(result.length,1);assert.equal(result[0].id,'mta:active');assert.equal(result[0].severity,'high');assert.equal(result[0].latitude,null);
});
test('MTA handles missing start/end and multiple active periods',()=>{
 const bytes=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:Date.parse(now)/1000},entity:[{id:'open',alert:{informedEntity:[{routeId:'1'}],headerText:{translation:[{text:'<b>Service change</b>'}]}}}]}).finish();
 assert.equal(normalizeMta(bytes,now)[0].title,'Service change');
});
test('road feed retains permit qualification and local dates',()=>{
 const [i]=normalizeRoads([{uniqueid:'1',onstreetname:'Broadway',borough_code:'M',work_start_date:'2026-11-11T00:00:00.000',the_geom:{coordinates:[[[-73.99,40.75],[-73.98,40.75]]]}}],now);
 assert.equal(i.borough,'Manhattan');assert.equal(i.start,'2026-11-11');assert.match(i.description,/does not confirm a full road closure/);assert.equal(i.latitude,40.75);
});
test('invalid Citizen integration is rejected rather than trusting arbitrary data',()=>{
 assert.throws(()=>normalizeCitizen({incidents:[{id:'x'}]},now));
});
const baseFare={milesAbove12mph:3,slowMinutes:5,localHour:17,weekday:true,holiday:false,south96:true,south60:true,tolls:0};
test('fare uses separate distance and slow-time units plus official surcharges',()=>{
 const f=estimateFare(baseFare);assert.equal(f.total,24.25);
 assert.equal(estimateFare({...baseFare,holiday:true}).total,21.75);
 assert.equal(estimateFare({...baseFare,localHour:20}).total,22.75);
 assert.equal(estimateFare({...baseFare,south96:false,south60:false}).total,21);
 assert.throws(()=>estimateFare({...baseFare,slowMinutes:-1}));
});
test('unlocated subway alerts never create invented local impact',()=>{
 const zone:Zone={id:161,name:'Midtown',borough:'Manhattan',latitude:40.75,longitude:-73.98};
 const i:Incident={id:'a',source:'MTA',title:'Closure',description:'',kind:'subway',borough:'Network-wide',severity:'high',start:null,end:null,latitude:null,longitude:null,routes:['A'],url:'https://www.mta.info/alerts',fetchedAt:now};
 assert.equal(estimateImpact([zone],[i])[0].score,0);
 const nearby={...i,latitude:zone.latitude,longitude:zone.longitude};assert.equal(estimateImpact([zone],[nearby])[0].score,80);
 assert.equal(estimateImpact([zone],[{...nearby,latitude:40.9}])[0].score,0);
});
test('retrieval ranks relevant evidence and abstains on out of scope question',()=>{
 const docs:Document[]=[{id:'fare',title:'Taxi fares',text:'Metered taxi fares include congestion surcharges.',url:'https://nyc.gov',kind:'fare'},{id:'model',title:'Graph model accuracy',text:'Graph neural network MAE results.',url:'https://github.com',kind:'research'}];
 assert.equal(retrieve('taxi fare surcharges',docs)[0].id,'fare');assert.equal(retrieve('volcanoes astronomy',docs).length,0);
});

test('arrival predictions reject stale feeds, skipped stops and canceled trips',async()=>{
 const {parseArrivals}=await import('../lib/arrivals');const stamp=Date.parse(now)/1000;
 const trip=(id:string,canceled:boolean,skipped:boolean)=>({id,tripUpdate:{trip:{tripId:id,routeId:'1',scheduleRelationship:canceled?3:0},stopTimeUpdate:[{stopId:'127N',arrival:{time:stamp+120},scheduleRelationship:skipped?1:0}]}});
 const encode=(timestamp:number)=>GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp},entity:[trip('valid',false,false),trip('canceled',true,false),trip('skipped',false,true)]}).finish();
 const result=parseArrivals(encode(stamp),'127',Date.parse(now));assert.equal(result.arrivals.length,1);assert.equal(result.arrivals[0].tripId,'valid');assert.throws(()=>parseArrivals(encode(stamp-301),'127',Date.parse(now)));
});
