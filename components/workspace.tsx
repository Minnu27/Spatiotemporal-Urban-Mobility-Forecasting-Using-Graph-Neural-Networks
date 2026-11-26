'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { browserClient } from '@/lib/private/browser';
import zones from '@/data/zones.json';
import type { Forecast } from '@/lib/types';
import SetupChecks from './setup-checks';

type Citation={index:number;title:string;url:string};
type Message={role:string;body:string;citations?:Citation[]};
type StoredDocument={id:string;title:string;filename:string;status:string;embedding_model:string;created_at:string;expires_at:string};
type Conversation={id:string;title:string;updated_at:string;expires_at:string};
type Account={configured:boolean;email?:string;embeddingsConfigured?:boolean;generationConfigured?:boolean};
async function api<T>(url:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(url,{method,cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Request unavailable.');return data;
}
function date(value:string){return new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' ET';}
function citationUrl(value:string){return value.startsWith('/api/documents/')||value.startsWith('/api/incidents?fingerprint=')||value==='/api/forecast'||/^https:\/\//.test(value)?value:'#';}
export default function Workspace(){
 const [account,setAccount]=useState<Account|null>(null),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 const [documents,setDocuments]=useState<StoredDocument[]>([]),[conversations,setConversations]=useState<Conversation[]>([]);
 const [title,setTitle]=useState(''),[filename,setFilename]=useState('notes.txt'),[text,setText]=useState(''),[consent,setConsent]=useState(false);
 const [question,setQuestion]=useState(''),[messages,setMessages]=useState<Message[]>([]),[conversationId,setConversationId]=useState<string>(),[remember,setRemember]=useState(false);
 const [includeDemand,setIncludeDemand]=useState(true),[zoneId,setZoneId]=useState(161),[horizon,setHorizon]=useState(1),[forecast,setForecast]=useState<Forecast|null>(null);
 const [includeArchive,setIncludeArchive]=useState(false);
 async function refresh(){const result=await api<Account>('/api/account');setAccount(result);if(result.email){
  const [docs,chats]=await Promise.all([api<{documents:StoredDocument[]}>('/api/documents'),api<{conversations:Conversation[]}>('/api/conversations')]);setDocuments(docs.documents);setConversations(chats.conversations);
 }}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));void api<Forecast>('/api/forecast').then(setForecast).catch(()=>{});},[]);
 async function action(key:string,run:()=>Promise<void>){if(busy)return;setBusy(key);setError('');setNotice('');try{await run();}catch(e){setError(e instanceof Error?e.message:'Request unavailable.');}finally{setBusy('');}}
 async function signIn(e:FormEvent){e.preventDefault();await action('sign-in',async()=>{
  const client=browserClient();if(!client)throw Error('Configure Supabase first. See the setup guide.');
  const result=await client.auth.signInWithPassword({email,password});setPassword('');if(result.error)throw Error('Sign-in failed. Check your email and password.');await refresh();
 });}
 async function upload(e:FormEvent){e.preventDefault();await action('upload',async()=>{
  await api('/api/documents','POST',{title,filename,text,consent});setText('');setTitle('');setConsent(false);await refresh();setNotice('Document indexed. It is available to your account for retrieval.');
 });}
 async function ask(e:FormEvent){e.preventDefault();const sent=question.trim();await action('chat',async()=>{
  const reply=await api<{answer:string;citations:Citation[];conversationId?:string;notice?:string;historySaved:boolean}>('/api/chat','POST',{
   question:sent,scope:'private',remember,conversationId,archive:includeArchive,demand:includeDemand?{zoneId,horizon}:undefined});
  setMessages(previous=>[...previous,{role:'user',body:sent},{role:'assistant',body:reply.answer,citations:reply.citations}]);setQuestion('');
  setConversationId(reply.conversationId||conversationId);if(reply.notice)setNotice(reply.notice);if(reply.historySaved)await refresh();
 });}
 const selected=forecast?.rows.find(row=>row.zoneId===zoneId&&row.horizon===horizon);
 return <main className="personal-workspace">
  <header className="workspace-header"><a href="/" className="text-link">← UrbanFlow dashboard</a><span className="small-tag">Private workspace</span></header>
  <div className="page-heading"><div><span className="eyebrow">YOUR SOURCES, YOUR ACCOUNT</span><h1>Keep useful context close.</h1><p>Save documents, retrieve cited evidence, and choose which conversations to keep.</p></div>
   {account?.email&&<button className="button" disabled={!!busy} onClick={()=>void action('sign-out',async()=>{await browserClient()?.auth.signOut();setAccount(null);setDocuments([]);setConversations([]);setMessages([]);setConversationId(undefined);setRemember(false);await refresh();})}>Sign out</button>}</div>
  {error&&<p role="alert" className="error-banner">{error}</p>}{notice&&<p role="status" className="workspace-notice">{notice}</p>}
  {!account?.email?<section className="panel workspace-login"><h2>Sign in to your account</h2>
   {account?.configured===false?<p>Private storage has not been configured. Follow the <a href="https://github.com/Minnu27/Spatiotemporal-Urban-Mobility-Forecasting-Using-Graph-Neural-Networks/blob/main/docs/SETUP.md" target="_blank" rel="noreferrer">setup guide ↗</a> to connect your Supabase project, apply the migration, and approve your account.</p>:
   <form onSubmit={signIn}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button" disabled={!!busy}>{busy==='sign-in'?'Signing in…':'Sign in'}</button></form>}
   <p>Accounts are created and approved by the site owner. Documents and saved chats are visible only to their owner. The public dashboard remains available without an account.</p></section>:
  <><div className="workspace-notice"><b>{account.email}</b><p>Documents expire after 90 days; saved conversations after 30 days. Embedding requests send document text to the configured provider. AI answers send your question, retrieved excerpts and recent conversation context to Qwen. Save only information you are comfortable sharing with those providers.</p>
   {(!account.embeddingsConfigured||!account.generationConfigured)&&<p>{!account.embeddingsConfigured?'Embeddings need a provider key. ':''}{!account.generationConfigured?'Qwen is not configured; answers use cited excerpts.':''}</p>}</div>
  <SetupChecks/>
  <div className="workspace-grid"><div className="workspace-column"><section className="panel workspace-card"><h2>Your knowledge</h2><p>Upload plain text or Markdown, up to 16,000 characters. Matching chunks are ranked with semantic and keyword search.</p>
   <form onSubmit={upload}><label>Document title<input required maxLength={180} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Choose a text or Markdown file<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void action('file',async()=>{if(file.size>100000)throw Error('Choose a file smaller than 100 KB.');const value=await file.text();if(value.length>16000)throw Error('Documents are limited to 16,000 characters.');setText(value);setFilename(file.name);setTitle(file.name.replace(/\.(txt|md)$/i,''));});}}/></label>
   <label>Document text<textarea required minLength={2} maxLength={16000} rows={7} value={text} onChange={e=>setText(e.target.value)}/></label>
   <label className="workspace-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I agree to send this document text to the embedding provider and store it privately in this project.</label><button className="button" disabled={!!busy||!consent||!account.embeddingsConfigured}>{busy==='upload'?'Indexing…':'Store and index document'}</button></form>
   <ul className="workspace-list">{documents.map(doc=><li key={doc.id}><b>{doc.title}</b><small>{doc.status} · {doc.embedding_model} · expires {date(doc.expires_at)}</small><div><a href={'/api/documents/'+doc.id} className="text-link">Download</a><button className="text-link" disabled={!!busy} onClick={()=>void action('delete-doc',async()=>{await api('/api/documents/'+doc.id,'DELETE');await refresh();setNotice('Document, chunks and embeddings deleted.');})}>Delete</button></div></li>)}</ul>{documents.length===0&&<p>No personal documents yet.</p>}</section>
   <section className="panel workspace-card"><h2>Saved conversations</h2><p>Saving is optional. Reopening a conversation restores its context on this account.</p><ul className="workspace-list">{conversations.map(chat=><li key={chat.id}><b>{chat.title}</b><small>Expires {date(chat.expires_at)}</small><div><button className="text-link" disabled={!!busy} onClick={()=>void action('open',async()=>{const data=await api<{messages:Message[]}>('/api/conversations/'+chat.id);setMessages(data.messages);setConversationId(chat.id);setRemember(true);})}>Open</button><a className="text-link" href={'/api/conversations/'+chat.id} download={'conversation-'+chat.id+'.json'}>Export JSON</a><button className="text-link" disabled={!!busy} onClick={()=>void action('delete-chat',async()=>{await api('/api/conversations/'+chat.id,'DELETE');if(conversationId===chat.id){setMessages([]);setConversationId(undefined);}await refresh();})}>Delete</button></div></li>)}</ul>{conversations.length===0&&<p>No saved conversations.</p>}</section></div>
   <section className="panel workspace-card workspace-chat"><div className="workspace-row"><h2>Ask your sources</h2><button className="text-link" disabled={!!busy} onClick={()=>{setMessages([]);setConversationId(undefined);setRemember(false);}}>New conversation</button></div>
    <label className="workspace-check"><input type="checkbox" checked={includeDemand} onChange={e=>setIncludeDemand(e.target.checked)}/>Include structured demand context</label>
    <label className="workspace-check"><input type="checkbox" checked={includeArchive} onChange={e=>setIncludeArchive(e.target.checked)}/>Search archived alerts too (historical snapshots, not current travel advice)</label>
    {includeDemand&&<div className="workspace-demand"><label>Taxi zone<select value={zoneId} onChange={e=>setZoneId(Number(e.target.value))}>{zones.map(zone=><option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label><label>Model horizon<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{[1,3,6,12,24].map(h=><option key={h} value={h}>{h} hours</option>)}</select></label>
    <p>{forecast?.mode==='estimate'?'Current-demand estimate':forecast?.mode||'Loading demand context…'}{selected?` · ${selected.value.toFixed(1)} estimated pickups`:''}</p><p>{forecast?.issuedAt?`Model origin: ${date(forecast.issuedAt)}. Target hour: ${date(new Date(Date.parse(forecast.issuedAt)+horizon*3600000).toISOString())}.`:''}</p><p>{forecast?.message}</p></div>}
    <div className="workspace-messages" aria-live="polite">{messages.length===0&&<p>Ask about your uploaded documents, current demand estimates, or official mobility alerts.</p>}{messages.map((message,index)=><article key={index} className={'workspace-message '+message.role}><b>{message.role==='user'?'You':'UrbanFlow'}</b><p>{message.body}</p>{message.citations&&<div className="citations">{message.citations.map(c=><a key={c.index} href={citationUrl(c.url)} target="_blank" rel="noreferrer">[{c.index}] {c.title} ↗</a>)}</div>}</article>)}</div>
    <form onSubmit={ask}><label>Your question<textarea required minLength={2} maxLength={1200} rows={3} value={question} onChange={e=>setQuestion(e.target.value)}/></label><label className="workspace-check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Save each new exchange in this conversation for 30 days</label><button className="button" disabled={!!busy||question.trim().length<2}>{busy==='chat'?'Retrieving evidence…':'Ask UrbanFlow'}</button></form><p>New conversations start with saving disabled. Selecting Save keeps subsequent exchanges; it does not retroactively store earlier messages. Unchecking Save stops new writes; delete saved conversations to remove existing history.</p>
   </section></div></>}
 </main>;
}
