import { getAlerts } from '@/lib/feeds';
export const dynamic='force-dynamic';
export async function GET() { return Response.json(await getAlerts(),{headers:{'Cache-Control':'no-store'}}); }
