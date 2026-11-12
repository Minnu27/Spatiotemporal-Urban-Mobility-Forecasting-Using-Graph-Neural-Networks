'use client';
import { FormEvent, useState } from 'react';
import { ArrowUp, BookOpen, Sparkles } from 'lucide-react';
type Reply={answer:string;mode:string;citations:{index:number;title:string;url:string}[];notice?:string};
export default function Chat(){
 const [question,setQuestion]=useState('');const [reply,setReply]=useState<Reply|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function ask(e:FormEvent){e.preventDefault();if(busy||question.trim().length<2)return;setBusy(true);setError('');
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question})});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not answer.');setReply(data);}catch(e){setError(e instanceof Error?e.message:'Chat unavailable.');}finally{setBusy(false);}}
 return <section className="panel assistant-panel"><div className="panel-heading"><div className="assistant-symbol"><Sparkles size={18}/></div><div><h2>Ask UrbanFlow</h2><p>Evidence first. Answers with sources.</p></div><span className="small-tag">Qwen + RAG</span></div>
 {!reply&&<div className="chat-intro"><span className="eyebrow">YOUR MOBILITY COPILOT</span><h3>A little context.<br/>A clearer way forward.</h3><p>Explore transit reports, graph results, and how taxi fares are calculated.</p><div className="suggestions">{['Which model performed best?','How are taxi fares calculated?','What subway disruptions are active?'].map(q=><button key={q} onClick={()=>setQuestion(q)}>{q}<span>↗</span></button>)}</div></div>}
 {reply&&<div className="chat-answer" aria-live="polite"><div className="answer-label"><BookOpen size={14}/>{reply.mode==='qwen'?'Qwen · retrieved evidence':'Retrieved source excerpts'}</div>{reply.notice&&<p className="notice">{reply.notice}</p>}<div className="answer-text">{reply.answer}</div><div className="citations">{reply.citations.map(c=><a key={c.index} href={c.url} target="_blank" rel="noreferrer">[{c.index}] {c.title} ↗</a>)}</div></div>}
 <form onSubmit={ask} className="chat-form"><label htmlFor="question" className="sr-only">Ask a mobility question</label><textarea id="question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1200} placeholder="Ask about NYC mobility…" rows={2}/><button disabled={busy||question.trim().length<2} aria-label="Send question">{busy?<span className="spinner"/>:<ArrowUp size={18}/>}</button></form>
 {error&&<p role="alert" className="form-error">{error}</p>}<p className="chat-footnote">Answers reflect retrieved sources. Check official alerts before travel.</p></section>;
}
