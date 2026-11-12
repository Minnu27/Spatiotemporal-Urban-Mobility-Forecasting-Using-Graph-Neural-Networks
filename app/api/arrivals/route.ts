import stations from '@/data/stations.json';
import { getArrivals } from '@/lib/arrivals';
export const dynamic='force-dynamic';
export async function GET(request:Request){const id=new URL(request.url).searchParams.get('station');const station=stations.find(s=>s.id===id);if(!station)return Response.json({error:'Select a known MTA station stop.'},{status:400});return Response.json(await getArrivals(station),{headers:{'Cache-Control':'no-store'}});}
