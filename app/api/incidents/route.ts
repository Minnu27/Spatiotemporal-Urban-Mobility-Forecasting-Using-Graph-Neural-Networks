import { requireMember,consumeLimit } from '@/lib/private/server';
import { AppError,errorResponse,privateJson } from '@/lib/private/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
  const {db}=await requireMember();await consumeLimit(db,'read');
  const fingerprint=new URL(request.url).searchParams.get('fingerprint');
  if(fingerprint&&!/^[a-f0-9]{64}$/.test(fingerprint))throw new AppError(400,'Invalid snapshot.');
  let query=db.from('incident_archive').select('fingerprint,source_id,payload,fetched_at').gt('expires_at',new Date().toISOString()).order('fetched_at',{ascending:false}).limit(100);
  if(fingerprint)query=query.eq('fingerprint',fingerprint);
  const {data,error}=await query;
  if(error)throw error;return privateJson({records:data,note:'Archived source versions. Dates must be checked before using these as active travel information.'});
}catch(error){return errorResponse(error);}}
