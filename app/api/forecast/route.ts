import { getForecast } from '@/lib/forecast';
export const dynamic='force-dynamic';
export async function GET(){return Response.json(await getForecast(),{headers:{'Cache-Control':'no-store'}});}
