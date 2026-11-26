import {connectionChecks} from '../lib/private/setup-checks';
import {getForecast} from '../lib/forecast';
import {readFile} from 'node:fs/promises';

async function main(){
 const report=await connectionChecks({providers:process.argv.includes('--providers')});
 for(const file of ['forecast.onnx','metadata.json','preprocessing.json','reference-profile.json']){
  try{await readFile('model/'+file);report.checks.push({id:'file_'+file,label:'Model file '+file,status:'pass',message:'Present.'});}
  catch{report.checks.push({id:'file_'+file,label:'Model file '+file,status:'fail',message:'Restore the bundled model artifact.'});}
 }
 const forecast=await getForecast();
 report.checks.push({id:'forecast',label:'Current-date forecast',status:(forecast.mode==='estimate'||forecast.mode==='live')&&forecast.rows.length===1315?'pass':'fail',message:`Mode: ${forecast.mode}. Origin: ${forecast.issuedAt}. Current observed pickups: ${forecast.mode==='live'}.`});
 report.ok=report.checks.every(check=>check.status!=='fail');
 if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
 else{
  for(const check of report.checks){console.log(`${check.status.toUpperCase()} ${check.label}: ${check.message}`);if(check.action)console.log('  Next step: '+check.action);}
  console.log(report.note);
  if(!process.argv.includes('--providers'))console.log('AI requests skipped. Use -- --providers to send two fixed non-personal connection tests; provider allowance or charges may apply.');
 }
 process.exitCode=report.ok?0:1;
}
void main().catch(()=>{console.error('Setup verification failed. Check docs/SETUP.md; no secret values were printed.');process.exitCode=1;});
