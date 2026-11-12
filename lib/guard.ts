import { fetchJson, serverUrl } from './http';
// Shared, atomic rate limit for all Vercel instances. Do not rely on in-memory maps.
export async function allowChat(client: string): Promise<boolean> {
  const url=process.env.UPSTASH_REDIS_REST_URL, token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return process.env.NODE_ENV !== 'production';
  const { createHash } = await import('node:crypto');
  const key='chat:'+createHash('sha256').update(client).digest('hex').slice(0,24)+':'+Math.floor(Date.now()/60_000);
  const result=await fetchJson(serverUrl(url),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",'1',key])}) as {result?:number};
  return typeof result.result==='number' && result.result<=15;
}
