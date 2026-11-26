'use client';
import { createBrowserClient } from '@supabase/ssr';
import {projectApiUrl} from '../supabase-config';
let client:ReturnType<typeof createBrowserClient>|undefined;
export function browserClient(){
  const url=projectApiUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return null;
  return client??=createBrowserClient(url,key);
}
