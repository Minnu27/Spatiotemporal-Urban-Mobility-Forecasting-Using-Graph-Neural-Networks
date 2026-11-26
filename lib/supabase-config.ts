// Shared by browser and server. A dashboard page is not a Supabase API base.
export function projectApiUrl(value:string|undefined):string|null{
 try{
  const url=new URL(value||'');
  if(url.protocol!=='https:'||url.hostname==='supabase.com'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
  return url.toString().replace(/\/$/,'');
 }catch{return null;}
}
