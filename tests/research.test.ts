import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import research from '../data/research.json';
import archive from '../data/research-archive.json';
import manifest from '../data/notebook-source.json';
import metadata from '../model/metadata.json';
import Research from '../components/research';
import {corpus,retrieve} from '../lib/rag';
test('new notebook code, readable copy, original archive and deployed metadata have explicit provenance',()=>{
 const bytes=readFileSync(research.notebook.path),notebook=JSON.parse(bytes.toString());
 const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(bytes),manifest.notebookSha256);assert.equal(hash(readFileSync(manifest.archivePath)),manifest.archiveSha256);
 assert.equal(manifest.originalSha256,'f91d8494a1499a09737d8fdd45132d2fd133306ecefd806bd63c761943dc5f67');
 assert.equal(hash(notebook.cells.filter((c:{cell_type:string})=>c.cell_type==='code').map((c:{source:string[]})=>c.source.join('')).join('\n\n')),manifest.codeSha256);
 assert.equal(notebook.cells.length,52);assert.equal(research.notebook.codeCells,39);assert.equal(research.notebook.cellsWithOutputs,37);
 const config=notebook.cells[36].source.join('');assert.match(config,/T_IN\s*=\s*12\b/);assert.match(config,/H\s*=\s*24\b/);assert.match(config,/EVAL_H\s*=\s*\[1, 3, 6, 12, 24\]/);
 assert.match(notebook.cells[44].source.join(''),/history_hours\s*=\s*MIN_HISTORY/);
 assert.equal(research.experiment.selectedModelInputHours,168);assert.equal(research.deployment.inputHours,metadata.history_hours);
 assert.deepEqual(research.experiment.evaluationHorizons,metadata.horizons);assert.equal(research.independentlyReproduced,false);assert.equal(research.deployment.benchmarkWeightsCryptographicallyLinked,false);
});
test('all five horizons and three subsets retain distinct saved metrics and source locations',()=>{
 const rows=research.results.rows;assert.equal(rows.length,270);
 assert.equal(new Set(rows.map(row=>`${row.model}:${row.subset}:${row.horizon}`)).size,270);
 for(const row of rows){assert.equal(row.split,'test');assert.equal(row.cellIndex,44);for(const metric of [row.mae,row.rmse,row.wmape])assert.ok(Number.isFinite(metric)&&metric>=0);}
 const selected=rows.filter(row=>row.model===research.results.selectedGnn&&row.subset==='all');
 assert.deepEqual(selected.map(row=>row.mae),[3.301,3.466,3.518,3.593,3.590]);
 assert.equal(research.results.winnerByHorizon.find(row=>row.horizon===12)!.model,'Residual Graph (distance + OD)');
 assert.equal(research.results.winnerByHorizon.find(row=>row.horizon===24)!.model,'Residual Graph (distance + OD)');
 const csv=readFileSync('public/research/benchmark.csv','utf8');assert.equal(csv.trim().split('\n').length,271);
 assert.equal(research.results.paperDuplicateRowsRemoved,1);
});
test('month splits, graph counts and error breakdowns use the new saved run',()=>{
 assert.deepEqual(research.experiment.splits.map(split=>split.months),[[1,3,4,6,7,8,10,12],[5,11],[2,9]]);
 assert.equal(research.experiment.splits.reduce((n,split)=>n+split.origins,0),6468);
 assert.equal(research.dataset.reportedCleanedMatrixTotal,48629564);assert.equal(research.dataset.countsVerifiedInThisRun,false);
 assert.equal(research.graphs.find(graph=>graph.name==='OD flow')!.edges,2320);assert.equal(research.graphs.find(graph=>graph.name==='Correlation')!.edges,2421);
 const event=research.breakdowns.conditions.find(row=>row.condition==='Event cells')!;assert.equal(event.selected,73.563);assert.ok(event.selected>event.spatialLightgbm);
 const staten=research.breakdowns.borough.find(row=>row.borough==='Staten Island')!;assert.ok(staten.selected>staten.gru);
});
test('Research renders reported current results and keeps the older run inside its archive',()=>{
 const html=renderToStaticMarkup(createElement(Research));const current=html.split('<details class="panel research-card research-archive"')[0];
 assert.ok(current.includes('Saved notebook benchmark'));assert.ok(current.includes('3.301'));assert.ok(!current.includes('rerun pending'));
 assert.ok(!current.includes('3.528'));assert.ok(html.includes('Earlier results before preprocessing corrections'));assert.ok(html.includes('3.528'));
 assert.ok(current.includes('Where the model helps'));assert.ok(current.includes('73.563'));
 assert.equal(archive.sha256,'12f5528d5967b18235a12be3e4f31b6c42df1a4bc7eb7d171fd60398697c55c8');
});
test('research RAG uses bounded per-model evidence instead of sending the complete benchmark',()=>{
 const docs=corpus({incidents:[],feeds:[],fetchedAt:''});const evidence=retrieve('Which model performed best?',docs).find(doc=>doc.id==='validation');assert.ok(evidence);
 assert.match(evidence.text,/3\.301/);assert.match(evidence.text,/validation-selected/);assert.match(evidence.text,/distance \+ OD/);
 const status=docs.find(doc=>doc.id==='research-status')!;assert.match(status.text,/saved_notebook_benchmark/);assert.ok(status.text.length<5000);
 const result=docs.find(doc=>doc.id==='research-result:Residual Graph (OD + correlation):all')!;assert.ok(result.text.length<2000);assert.match(result.text,/3\.59/);
 assert.ok(retrieve('Residual Graph OD correlation event results',docs).some(doc=>doc.id==='research-result:Residual Graph (OD + correlation):events'));
});
