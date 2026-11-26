import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AppError } from './http';
import {databaseIssue} from './setup-errors';
import {projectApiUrl} from '../supabase-config';
const timedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:init?.signal??AbortSignal.timeout(10000)});

export function storageConfigured(){return !!projectApiUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)&&!!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;}
export async function userClient(){
  if(!storageConfigured())throw new AppError(503,'Private workspace is not configured. Follow docs/SETUP.md.');
  const jar=await cookies();
  return createServerClient(projectApiUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
    global:{fetch:timedFetch},
    cookies:{getAll:()=>jar.getAll(),setAll:values=>{for(const {name,value,options} of values)jar.set(name,value,options);}},
  });
}
export async function requireMember(){
  const db=await userClient();
  const {data,error}=await db.auth.getUser();
  if(error||!data.user)throw new AppError(401,'Sign in to your private workspace.');
  const membership=await db.from('app_members').select('user_id').eq('user_id',data.user.id).eq('enabled',true).maybeSingle();
  if(membership.error)throw new AppError(503,'Apply the database migration before using the workspace.');
  if(!membership.data)throw new AppError(403,'Your account is not approved for this workspace.');
  return {db,user:data.user};
}
// Admin credentials are never used for personal document search/history.
export function adminClient(){
  const url=projectApiUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return null;
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:timedFetch}});
}
export async function consumeLimit(db:Awaited<ReturnType<typeof userClient>>,scope:'chat'|'upload'|'read'){
  const {data,error,status}=await db.rpc('consume_app_limit',{p_scope:scope});
  if(error){const issue=databaseIssue(error,status);throw new AppError(503,issue.message+' '+issue.action);}
  if(data!==true)throw new AppError(429,'Your request limit has been reached. Retry later.');
}
