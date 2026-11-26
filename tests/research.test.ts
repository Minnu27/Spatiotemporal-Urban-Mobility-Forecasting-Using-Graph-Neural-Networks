import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import research from '../data/research.json';
import archive from '../data/research-archive.json';
import metadata from '../model/metadata.json';
import Research from '../components/research';
import {corpus,retrieve} from '../lib/rag';
test('research provenance and configuration match the checked-in notebook and export',()=>{
 const bytes=readFileSync(research.notebook.path),notebook=JSON.parse(bytes.toString());
 assert.equal(createHash('sha256').update(bytes).digest('hex'),research.notebook.sha256);
 assert.equal(notebook.cells.filter((cell:{outputs?:unknown[]})=>cell.outputs?.length).length,research.notebook.cellsWithOutputs);
 const source=notebook.cells[research.notebook.configurationCellIndex].source.join('');
 assert.match(source,/T_IN\s*=\s*12\b/);assert.match(source,/H\s*=\s*6\b/);assert.match(source,/EVAL_H\s*=\s*\[1, 3, 6\]/);
 assert.equal(research.experiment.inputHours,12);assert.deepEqual(research.experiment.evaluationHorizons,[1,3,6]);
 assert.equal(research.deployment.inputHours,metadata.history_hours);assert.deepEqual(research.deployment.horizons,metadata.horizons);
 assert.equal(research.experiment.contextFeatures.length,14);assert.equal(research.deployment.zones,263);
 assert.deepEqual(research.results.rows,[]);assert.equal(research.results.winner,null);
});
test('current Research does not present archived scores or graph counts as new results',()=>{
 const html=renderToStaticMarkup(createElement(Research));
 const beforeArchive=html.split('<details class="panel research-card research-archive"')[0];
 assert.ok(beforeArchive.includes('evaluation rerun pending'));assert.ok(beforeArchive.includes('12 hours'));assert.ok(beforeArchive.includes('168 hours'));
 assert.ok(!beforeArchive.includes('3.528'));assert.ok(!beforeArchive.includes('2,413'));
 assert.ok(html.includes('Archived results before preprocessing corrections'));assert.ok(html.includes('3.528'));
 assert.equal(archive.sha256,'12f5528d5967b18235a12be3e4f31b6c42df1a4bc7eb7d171fd60398697c55c8');assert.equal(archive.rows.length,18);
});
test('research chat evidence describes the current notebook without claiming a measured winner',()=>{
 const documents=corpus({incidents:[],feeds:[],fetchedAt:''});
 const current=retrieve('Which model performed best?',documents).find(doc=>doc.id==='validation');assert.ok(current);
 assert.match(current.text,/no current measured winner/i);assert.match(current.text,/12-hour input/);assert.match(current.text,/archived pre-correction/);
 const status=documents.find(doc=>doc.id==='research-status');assert.ok(status);assert.match(status.text,/awaiting_notebook_rerun/);
});
