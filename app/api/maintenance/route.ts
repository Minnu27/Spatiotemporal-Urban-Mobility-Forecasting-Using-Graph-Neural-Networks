import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/private/server';
import { AppError,errorResponse,privateJson } from '@/lib/private/http';
import { getAlerts } from '@/lib/feeds';
import { archiveAlerts } from '@/lib/private/archive';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){try{
  const secret=process.env.MAINTENANCE_TOKEN,provided=request.headers.get('authorization');
  if(!secret||!provided)throw new AppError(401,'Unauthorized.');
  const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(provided);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new AppError(401,'Unauthorized.');
  const db=adminClient();if(!db)throw new AppError(503,'Maintenance storage is not configured.');
  const expired=await db.from('rag_documents').select('id,storage_path').or(`expires_at.lt.${new Date().toISOString()},status.eq.deleting,and(status.eq.indexing,created_at.lt.${new Date(Date.now()-3600000).toISOString()})`).limit(50);
  if(expired.error)throw expired.error;
  let removed=0,failed=0;
  for(const document of expired.data||[]){
    const hidden=await db.from('rag_documents').update({status:'deleting'}).eq('id',document.id);
    if(hidden.error){failed++;continue;}
    const file=await db.storage.from('rag-private').remove([document.storage_path]);
    if(file.error){failed++;continue;}
    const row=await db.from('rag_documents').delete().eq('id',document.id);if(row.error)failed++;else removed++;
  }
  const cutoff=new Date().toISOString();
  const history=await db.from('conversations').delete().lt('expires_at',cutoff);if(history.error)throw history.error;
  const archive=await db.from('incident_archive').delete().lt('expires_at',cutoff);if(archive.error)throw archive.error;
  for(const table of ['request_limits','public_request_limits']){
    const pruned=await db.from(table).delete().lt('window_at',new Date(Date.now()-2*86400000).toISOString());if(pruned.error)throw pruned.error;
  }
  const orphans=await db.rpc('orphan_private_objects');if(orphans.error)throw orphans.error;
  const paths=(orphans.data||[]).map((row:{storage_path:string})=>row.storage_path);
  if(paths.length){const cleanup=await db.storage.from('rag-private').remove(paths);if(cleanup.error)throw cleanup.error;}
  const alerts=await getAlerts(true);await archiveAlerts(alerts);
  const feeds=alerts.feeds.map(({source,state})=>({source,state}));
  return privateJson({documentsRemoved:removed,documentFailures:failed,orphanFilesRemoved:paths.length,feeds,refreshedAt:cutoff},failed||feeds.some(feed=>feed.state!=='live')?207:200);
}catch(error){return errorResponse(error);}}
