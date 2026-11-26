import { getForecast } from '@/lib/forecast';
import { routingProvider } from '@/lib/trip-fare';
import { storageConfigured } from '@/lib/private/server';
export const dynamic='force-dynamic';
export async function GET(){const forecast=await getForecast();const workspace=storageConfigured(),admin=workspace&&!!process.env.SUPABASE_SERVICE_ROLE_KEY;
 return Response.json({status:forecast.mode==='unavailable'?'degraded':'ok',configurationOnly:true,
  qwenConfigured:!!process.env.QWEN_API_KEY,embeddingsConfigured:!!(process.env.EMBEDDING_API_KEY||process.env.QWEN_API_KEY),
  privateWorkspaceConfigured:workspace,archiveConfigured:admin,maintenanceConfigured:admin&&!!process.env.MAINTENANCE_TOKEN,
  sharedRateLimitConfigured:(!!process.env.UPSTASH_REDIS_REST_URL&&!!process.env.UPSTASH_REDIS_REST_TOKEN)||(admin&&(process.env.RATE_LIMIT_SALT?.length??0)>=32),
  modelConfigured:forecast.mode!=='unavailable',forecastMode:forecast.mode,forecastOrigin:forecast.issuedAt,forecastMessage:forecast.message,
  observedCurrentPickups:forecast.mode==='live',routingConfigured:!!routingProvider(),citizenConfigured:!!process.env.CITIZEN_FEED_URL},
  {headers:{'Cache-Control':'no-store'}});}
