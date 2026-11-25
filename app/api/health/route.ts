import { getForecast } from '@/lib/forecast';
import { routingProvider } from '@/lib/trip-fare';
export const dynamic='force-dynamic';
export async function GET(){const forecast=await getForecast();return Response.json({status:'ok',qwenConfigured:!!process.env.QWEN_API_KEY,sharedRateLimitConfigured:!!process.env.UPSTASH_REDIS_REST_URL&&!!process.env.UPSTASH_REDIS_REST_TOKEN,modelConfigured:forecast.mode!=='unavailable',forecastMode:forecast.mode,routingConfigured:!!routingProvider(),citizenConfigured:!!process.env.CITIZEN_FEED_URL});}
