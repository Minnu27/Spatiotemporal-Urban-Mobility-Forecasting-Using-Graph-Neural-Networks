'use client';
import {useState} from 'react';
import type {SetupCheck} from '@/lib/private/setup-config';
type Report={ok:boolean;checks:SetupCheck[];checkedAt:string;note:string};
export default function SetupChecks(){
 const [providers,setProviders]=useState(false),[busy,setBusy]=useState(false),[report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
 async function run(){if(busy)return;setBusy(true);setError('');try{
  const response=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({providers,consent:providers}),signal:AbortSignal.timeout(120000),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Connection checks are unavailable.');setReport(data);
 }catch(e){setError(e instanceof Error?e.message:'Connection checks are unavailable.');}finally{setBusy(false);}}
 return <details className="panel workspace-card setup-checks"><summary>Connection checks</summary><p>Check storage, database access and optional AI connections. Results contain status and repair instructions; credentials stay on the server.</p>
  <label className="workspace-check"><input type="checkbox" checked={providers} onChange={e=>setProviders(e.target.checked)}/>Also test chat and embeddings using fixed non-personal text. These two requests consume your provider allowance and may incur charges.</label>
  <button type="button" className="button" disabled={busy} onClick={()=>void run()}>{busy?'Checking connections…':'Run connection checks'}</button>
  {error&&<p role="alert" className="error-banner">{error}</p>}
  {report&&<div aria-live="polite"><p><b>{report.ok?'Requested checks passed.':'Some connections need attention.'}</b></p><ul className="workspace-list">{report.checks.map(check=><li key={check.id}><b className={'setup-'+check.status}>{check.status.toUpperCase()} · {check.label}</b><p>{check.message}</p>{check.action&&<p><b>Next step:</b> {check.action}</p>}</li>)}</ul><p>{report.note}</p></div>}
 </details>;
}
