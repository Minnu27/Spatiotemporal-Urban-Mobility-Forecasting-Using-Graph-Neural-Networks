import knowledge from '@/data/knowledge.json';
import research from '@/data/research.json';
import type { AlertResult, Document } from './types';
const synonyms:Record<string,string>={cab:'taxi',cabs:'taxi',prices:'fare',price:'fare',pricing:'fare',fares:'fare',cost:'fare',costs:'fare',models:'model',predictions:'forecast',prediction:'forecast',predict:'forecast',closures:'closure',closing:'closure',closed:'closure',trains:'train',subways:'subway',results:'result'};
export const tokens=(s:string): string[] =>(s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(t=>synonyms[t] ?? t);
export function contextualQuery(question:string,history:{role:string;body:string}[]=[]){
 const followup=/^(and\b|also\b|why\b|what about\b|what if\b|explain more\b|tell me more\b|shorter\b|simpler\b|in simple\b)|\b(it|this|that|those|them|they|earlier|previous|same)\b/i.test(question);
 const previous=followup?history.filter(message=>message.role==='user').slice(-2).map(message=>message.body.slice(0,600)).join(' '):'';
 return question+(previous?' '+previous:'');
}
export function needsLiveAlerts(query:string){return /\b(alerts?|delays?|disruptions?|disrupted|closures?|closed|construction|roadwork|subway|trains?|mta|traffic|incidents?)\b/i.test(query);}
const stop=new Set(['the','is','a','an','to','for','of','in','on','and','what','how','are','it','me','about','can','i']);
export function retrieve(query: string, docs: Document[], limit=5): Document[] {
  const q=[...new Set(tokens(query).filter(t=>!stop.has(t)))];
  if (!q.length) return [];
  const bags=docs.map(d=>tokens(d.title+' '+d.text));
  const counts=bags.map(words=>{const counts=new Map<string,number>();for(const word of words)counts.set(word,(counts.get(word)||0)+1);return counts;});
  const frequency=new Map(q.map(term=>[term,counts.filter(bag=>bag.has(term)).length]));
  const average=bags.reduce((s,b)=>s+b.length,0)/Math.max(bags.length,1);
  return docs.map((doc,i)=> {
    const words=bags[i]; const score=q.reduce((sum,t)=> {
      const tf=counts[i].get(t)||0;
      const df=frequency.get(t)||0;
      const idf=Math.log(1+(docs.length-df+0.5)/(df+0.5));
      return sum+idf*(tf*2.2)/(tf+1.2*(0.25+0.75*words.length/average));
    },0); return {doc,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.doc);
}
export function corpus(alerts: AlertResult): Document[] {
  const liveSummary:Document[]=alerts.feeds.length?[{id:'active-alerts',title:'Current active subway disruptions and road construction reports',
    text:JSON.stringify({fetchedAt:alerts.fetchedAt,feeds:alerts.feeds,activeSubwayAlerts:alerts.incidents.filter(i=>i.kind==='subway').length,
      recentSubwayReports:alerts.incidents.filter(i=>i.kind==='subway').slice(0,8).map(i=>({title:i.title,description:i.description.slice(0,450),routes:i.routes})),
      plannedRoadWorkPermits:alerts.incidents.filter(i=>i.kind==='road').length,qualification:'Counts cover returned feed records. Missing reports do not establish normal service. Work permits do not confirm a road closure.'}),
    url:'/api/alerts',kind:'alert'}]:[];
  const notebookUrl=`https://github.com/Minnu27/Spatiotemporal-Urban-Mobility-Forecasting-Using-Graph-Neural-Networks/blob/${research.notebook.commit}/${encodeURIComponent(research.notebook.path)}`;
  const researchResults=research.experiment.models.flatMap(model=>['all','active','events'].map(subset=>({
    id:'research-result:'+model+':'+subset,title:`${model} · ${subset} held-out test results`,kind:'research',url:notebookUrl,
    text:JSON.stringify({model,subset,testMonths:'February and September 2025',reportedPrecisionDecimals:3,independentlyReproduced:false,
      results:research.results.rows.filter(row=>row.model===model&&row.subset===subset).map(({horizon,mae,rmse,wmape})=>({horizon,mae,rmse,wmape})),
      qualification:'Historical seeded-month benchmark. WMAPE is a ratio. Not current observed demand or prospective deployment accuracy.'})
  })));
  return [...knowledge,...liveSummary, {id:'research-status',title:'New notebook research run and selection status',text:JSON.stringify({status:research.status,dataset:research.dataset,
    inputHours:research.experiment.inputHours,selectedModelInputHours:research.experiment.selectedModelInputHours,evaluationHorizons:research.experiment.evaluationHorizons,
    splitMethod:research.experiment.splitMethod,splitSeed:research.experiment.splitSeed,splits:research.experiment.splits,
    selectedGnn:research.results.selectedGnn,selectedBaseline:research.results.selectedBaseline,winnerByHorizon:research.results.winnerByHorizon,
    rowCount:research.results.rows.length,limitations:research.limitations.slice(0,4)}),url:notebookUrl,kind:'research'},...researchResults,
    ...alerts.feeds.map((f,i)=>({id:`feed-${i}`,title:`${f.source} feed status`,text:`${f.state}. ${f.detail} Last fetched ${f.fetchedAt}.`,kind:'status',url:f.source==='MTA'?'https://www.mta.info/alerts':'https://data.cityofnewyork.us/'})),
    ...alerts.incidents.map(i=>({id:i.id,title:i.title,text:`Source: ${i.source}. ${i.description} Routes: ${i.routes.join(', ')}. Borough: ${i.borough}. Starts: ${i.start ?? 'not specified'}. Ends: ${i.end ?? 'not specified'}. Fetched: ${i.fetchedAt}.`,url:i.url,kind:'alert'}))];
}
export function extractiveAnswer(docs: Document[], reason = 'Qwen is not configured.'): string {
  if (!docs.length) return 'I could not find supporting information. Try asking about a subway route, construction, graph results, forecasting, or taxi fares.';
  return reason+' Here are relevant source excerpts:\n\n'+docs.slice(0,3).map((d,i)=>`[${i+1}] ${d.title}\n${d.text}`).join('\n\n');
}
