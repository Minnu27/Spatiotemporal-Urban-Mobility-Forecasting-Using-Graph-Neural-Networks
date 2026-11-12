export const dynamic='force-dynamic';
export async function GET(){return Response.json({status:'ok',qwenConfigured:!!process.env.QWEN_API_KEY,sharedRateLimitConfigured:!!process.env.UPSTASH_REDIS_REST_URL&&!!process.env.UPSTASH_REDIS_REST_TOKEN,modelConfigured:!!process.env.MODEL_SERVICE_URL&&!!process.env.MODEL_SERVICE_TOKEN,citizenConfigured:!!process.env.CITIZEN_FEED_URL});}
