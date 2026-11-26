import { createHash } from 'node:crypto';
import { adminClient } from './server';
import type { AlertResult } from '../types';
import type { Document } from '../types';
import type { userClient } from './server';
export async function retrieveArchive(question:string,db:Awaited<ReturnType<typeof userClient>>):Promise<Document[]>{
 const {data,error}=await db.from('incident_archive').select('fingerprint,payload,fetched_at').gt('expires_at',new Date().toISOString())
  .textSearch('search_text',question,{type:'plain',config:'english'}).order('fetched_at',{ascending:false}).limit(4);
 if(error)throw error;
 return (data||[]).map(row=>({id:'archive:'+row.fingerprint,title:`Archived incident · ${row.payload.title} · ${row.fetched_at}`,
  text:JSON.stringify({archived:true,notCurrentTravelEvidence:true,fetchedAt:row.fetched_at,incident:row.payload}),
  url:'/api/incidents?fingerprint='+row.fingerprint,kind:'archive'}));
}
export async function archiveAlerts(alerts:AlertResult){
  const db=adminClient();if(!db||!alerts.incidents.length)return;
  const rows=alerts.incidents.map(incident=>{
    const {fetchedAt,...version}=incident;
    return {fingerprint:createHash('sha256').update(JSON.stringify(version)).digest('hex'),source_id:incident.id,payload:incident,
      fetched_at:fetchedAt,expires_at:new Date(Date.now()+30*86400000).toISOString()};
  });
  const {error}=await db.from('incident_archive').upsert(rows,{onConflict:'fingerprint'});
  if(error)throw Error('Incident archive write failed');
}
