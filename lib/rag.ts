import knowledge from '@/data/knowledge.json';
import research from '@/data/research.json';
import type { AlertResult, Document } from './types';
const synonyms:Record<string,string>={cab:'taxi',cabs:'taxi',prices:'fare',price:'fare',pricing:'fare',fares:'fare',cost:'fare',costs:'fare',models:'model',predictions:'forecast',prediction:'forecast',predict:'forecast',closures:'closure',closing:'closure',closed:'closure',trains:'train',subways:'subway',results:'result'};
export const tokens=(s:string): string[] =>(s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(t=>synonyms[t] ?? t);
const stop=new Set(['the','is','a','an','to','for','of','in','on','and','what','how','are','it','me','about','can','i']);
export function retrieve(query: string, docs: Document[], limit=5): Document[] {
  const q=[...new Set(tokens(query).filter(t=>!stop.has(t)))];
  if (!q.length) return [];
  const bags=docs.map(d=>tokens(d.title+' '+d.text));
  const average=bags.reduce((s,b)=>s+b.length,0)/Math.max(bags.length,1);
  return docs.map((doc,i)=> {
    const words=bags[i]; const score=q.reduce((sum,t)=> {
      const tf=words.filter(w=>w===t).length;
      const df=bags.filter(b=>b.includes(t)).length;
      const idf=Math.log(1+(docs.length-df+0.5)/(df+0.5));
      return sum+idf*(tf*2.2)/(tf+1.2*(0.25+0.75*words.length/average));
    },0); return {doc,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.doc);
}
export function corpus(alerts: AlertResult): Document[] {
  return [...knowledge, {id:'research-status',title:'Research report status',text:JSON.stringify({status:research.status,limitations:research.limitations}),url:knowledge[0].url,kind:'research'},
    ...alerts.feeds.map((f,i)=>({id:`feed-${i}`,title:`${f.source} feed status`,text:`${f.state}. ${f.detail} Last fetched ${f.fetchedAt}.`,kind:'status',url:f.source==='MTA'?'https://www.mta.info/alerts':'https://data.cityofnewyork.us/'})),
    ...alerts.incidents.map(i=>({id:i.id,title:i.title,text:`Source: ${i.source}. ${i.description} Routes: ${i.routes.join(', ')}. Borough: ${i.borough}. Starts: ${i.start ?? 'not specified'}. Ends: ${i.end ?? 'not specified'}. Fetched: ${i.fetchedAt}.`,url:i.url,kind:'alert'}))];
}
export function extractiveAnswer(docs: Document[], reason = 'Qwen is not configured.'): string {
  if (!docs.length) return 'I could not find supporting information. Try asking about a subway route, construction, graph results, forecasting, or taxi fares.';
  return reason+' Here are relevant source excerpts:\n\n'+docs.slice(0,3).map((d,i)=>`[${i+1}] ${d.title}\n${d.text}`).join('\n\n');
}
