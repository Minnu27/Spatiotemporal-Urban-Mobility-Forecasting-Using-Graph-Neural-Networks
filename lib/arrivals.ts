import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { fetchBounded } from './http';
export type Arrival={route:string;stopId:string;at:string;direction:string;tripId:string};
export type ArrivalResult={state:'live'|'partial'|'unavailable';arrivals:Arrival[];fetchedAt:string;feedTimes:string[];message:string};
const groups:Record<string,string[]>={gtfs:['1','2','3','4','5','6','7','S'], 'gtfs-ace':['A','C','E'], 'gtfs-bdfm':['B','D','F','M'], 'gtfs-g':['G'], 'gtfs-jz':['J','Z'], 'gtfs-l':['L'], 'gtfs-nqrw':['N','Q','R','W'], 'gtfs-si':['SI']};
export function parseArrivals(bytes:Uint8Array,station:string,now:number):{arrivals:Arrival[];feedTime:string} {
 const feed=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
 const stamp=Number(feed.header.timestamp)*1000;
 if(!stamp||now-stamp>5*60_000||stamp>now+60_000)throw Error('Stale or future-dated train feed');
 const arrivals:Arrival[]=[];
 for(const e of feed.entity??[]){const trip=e.tripUpdate;if(!trip||trip.trip.scheduleRelationship===3||Number(trip.trip.scheduleRelationship)===7)continue;
  for(const s of trip.stopTimeUpdate??[]){if(s.scheduleRelationship===1||s.scheduleRelationship===2)continue;
   const id=s.stopId??'';if(id!==station+'N'&&id!==station+'S')continue;
   const at=Number(s.arrival?.time||s.departure?.time)*1000;
   if(at<now||at>now+60*60_000||!at)continue;
   arrivals.push({route:trip.trip.routeId??'?',stopId:id,at:new Date(at).toISOString(),direction:id.endsWith('N')?'Northbound':'Southbound',tripId:trip.trip.tripId??e.id});
  }
 }
 return {arrivals,feedTime:new Date(stamp).toISOString()};
}
const cache=new Map<string,{expires:number;value:ArrivalResult}>();
export async function getArrivals(station:{id:string;routes:string[]}):Promise<ArrivalResult>{
 const old=cache.get(station.id);if(old&&old.expires>Date.now())return old.value;
 const now=Date.now();const names=Object.keys(groups).filter(g=>station.routes.some(r=>groups[g].includes(r)));
 const results=await Promise.allSettled(names.map(async name=>parseArrivals(await fetchBounded(`https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F${name}`,{},5_000_000),station.id,now)));
 const good=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
 const arrivals=[...new Map(good.flatMap(r=>r.arrivals).map(a=>[a.tripId+':'+a.stopId,a])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(0,12);
 const value:ArrivalResult={state:!good.length?'unavailable':good.length===names.length?'live':'partial',arrivals,fetchedAt:new Date().toISOString(),feedTimes:good.map(r=>r.feedTime),message:'MTA real-time predictions for the next 60 minutes. Predictions may change; missing arrivals do not establish no service. North/south labels follow GTFS stop direction, not destination.'};
 if(cache.size>=100)cache.clear();cache.set(station.id,{expires:Date.now()+20_000,value});return value;
}
