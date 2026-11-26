'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUp,BookOpen,Sparkles,Square} from 'lucide-react';
import {recentHistory,streamLines,type ChatEvent,type ChatReply} from '@/lib/chat-protocol';
import {useChatSession,type ChatTurn} from './chat-state';
export default function Chat(){
 const {turns,setTurns}=useChatSession();
 const [question,setQuestion]=useState(''),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null),log=useRef<HTMLDivElement>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[turns,draft,status]);
 function append(turn:ChatTurn){setTurns(previous=>[...previous,turn].slice(-40));}
 async function ask(e:FormEvent){e.preventDefault();const sent=question.trim();if(busy||!sent)return;
  const history=recentHistory(turns);const controller=new AbortController();active.current=controller;
  append({id:crypto.randomUUID(),role:'user',body:sent});
  setQuestion('');setDraft('');setBusy(true);setError('');setStatus('Finding relevant sources…');
  try{
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:sent,history,stream:true}),signal:controller.signal});
   if(!response.ok){const data=await response.json();throw Error(data.error||'Could not answer.');}
   let completed=false;
   function finish(reply:ChatReply){completed=true;setDraft('');append({id:crypto.randomUUID(),role:'assistant',body:reply.answer,reply});}
   if(response.headers.get('content-type')?.includes('application/x-ndjson')){
    if(!response.body)throw Error('The chat connection was empty. Please retry.');
    for await(const line of streamLines(response.body)){
     if(!line.trim())continue;const event=JSON.parse(line) as ChatEvent;
     if(event.type==='status')setStatus(event.message);
     else if(event.type==='delta')setDraft(previous=>previous+event.text);
     else if(event.type==='error')throw Error(event.message);
     else if(event.type==='done')finish(event.reply);
    }
   }else finish(await response.json());
   if(!completed)throw Error('The connection ended before the answer finished. Please retry.');
  }catch(e){
   if(controller.signal.aborted)setStatus('Response stopped. You can ask another question.');
   else{setError(e instanceof Error?e.message:'Chat unavailable.');setQuestion(current=>current||sent);}
  }finally{setBusy(false);setDraft('');active.current=null;}
 }
 function reset(){active.current?.abort();setTurns([]);setQuestion('');setDraft('');setError('');setStatus('');}
 return <section className="panel assistant-panel"><div className="panel-heading"><div className="assistant-symbol"><Sparkles size={18}/></div><div><h2>Ask UrbanFlow</h2><p>Ask a question. Keep the conversation going.</p></div><button className="text-link chat-reset" onClick={reset} disabled={busy||!turns.length}>New chat</button></div>
 {!turns.length&&<div className="chat-intro"><span className="eyebrow">YOUR MOBILITY COPILOT</span><h3>What’s on your mind?</h3><p>Ask in your own words about trips, weather, the research, or anything you want explained. Follow-up questions work too.</p><div className="suggestions">{['Help me plan a taxi trip','Explain graph neural networks simply','What is the weather in NYC?'].map(q=><button key={q} onClick={()=>setQuestion(q)}>{q}<span>↗</span></button>)}</div></div>}
 {!!turns.length&&<div className="chat-thread" ref={log} role="log" aria-label="Chat conversation" aria-live="polite">
 {turns.map(turn=><article key={turn.id} className={'chat-turn '+turn.role}>
  <div className="answer-label">{turn.role==='user'?'You':<><BookOpen size={14}/>{turn.reply?.mode==='general'?'UrbanFlow · general conversation':turn.reply?.mode==='qwen'?'UrbanFlow · cited answer':'Retrieved sources'}</>}</div>
  {turn.reply?.notice&&<p className="notice">{turn.reply.notice}</p>}<div className="answer-text">{turn.body}</div>
  {!!turn.reply?.citations.length&&<div className="citations">{turn.reply.citations.map(c=><a key={c.index} href={c.url} target="_blank" rel="noreferrer">[{c.index}] {c.title} ↗</a>)}</div>}
 </article>)}
 {busy&&<article className="chat-turn assistant"><div className="answer-label">{draft?'Writing · sources pending':status}</div><div className="answer-text">{draft||'…'}</div></article>}
 </div>}
 <form onSubmit={ask} className="chat-form"><label htmlFor="question" className="sr-only">Ask UrbanFlow</label><textarea id="question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1200} placeholder="Ask anything, or follow up…" rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy)e.currentTarget.form?.requestSubmit();}}}/>
 {busy?<button type="button" onClick={()=>active.current?.abort()} aria-label="Stop response"><Square size={15}/></button>:<button disabled={!question.trim()} aria-label="Send question"><ArrowUp size={18}/></button>}</form>
 {error&&<p role="alert" className="form-error">{error}</p>}
 <p role="status" className="chat-footnote">{busy||status.startsWith('Response stopped')?status:'Enter to send · Shift + Enter for a new line. Check official sources before travel.'}</p>
 <details className="chat-privacy"><summary>How your conversation is used</summary><p>This chat stays in memory while the page is open and follows you between dashboard sections. Recent messages and matching sources are sent to Qwen for follow-up questions. Refreshing or selecting New chat clears this public conversation. Use the <a href="/workspace">private workspace</a> for personal documents and optional saved history. Text shown while writing is a draft; final source checks can replace it with retrieved evidence.</p></details></section>;
}
