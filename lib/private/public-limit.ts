import { createHmac } from 'node:crypto';
import { allowChat } from '../guard';
import { adminClient } from './server';
import { AppError } from './http';
import {databaseIssue} from './setup-errors';
export async function consumePublicLimit(request:Request){
 // Vercel sets this header; other hosts share a conservative anonymous bucket.
 const client=process.env.VERCEL?request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'anonymous':'anonymous';
 if(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN){
  let allowed=false;try{allowed=await allowChat(client);}catch{throw new AppError(503,'Shared chat limits are unavailable. Retry later.');}
  if(!allowed)throw new AppError(429,'Chat request limit reached. Retry in a minute.');return;
 }
 const db=adminClient(),salt=process.env.RATE_LIMIT_SALT;
 if(!db||!salt||salt.length<32)throw new AppError(503,'Public chat needs shared request limits. Configure the private workspace or Upstash using docs/SETUP.md.');
 const hash=createHmac('sha256',salt).update(client).digest('hex');
 const {data,error,status}=await db.rpc('consume_public_limit',{p_hash:hash});
 if(error){console.warn('Public chat database check failed',{category:databaseIssue(error,status).code});throw new AppError(503,'Shared chat limits are unavailable. Retry later.');}
 if(data!==true)throw new AppError(429,'Chat request limit reached. Retry later.');
}
