import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildEstimateInputs} from '../lib/current-estimate';
import {isModelHoliday} from '../lib/model-calendar';
test('model holidays use the training calendar, including observed Saturdays',()=>{
 assert.equal(isModelHoliday(2026,2,12),false); // NY Lincoln holiday is not a federal holiday
 assert.equal(isModelHoliday(2026,7,3),true);assert.equal(isModelHoliday(2026,7,4),false);
 assert.equal(isModelHoliday(2021,12,31),true);assert.equal(isModelHoliday(2026,11,26),true);
});
test('estimate inputs align real reference counts, NY holidays and original weather scaling',async()=>{
 const profile=JSON.parse(await readFile('model/reference-profile.json','utf8'));
 const {weather_scaling:scaling}=JSON.parse(await readFile('model/preprocessing.json','utf8'));
 const origin=Date.parse('2026-11-26T15:00:00Z'); // Thanksgiving, 10 AM EST
 const time=Array.from({length:168},(_,i)=>(origin-(167-i)*3600000)/1000);
 const weather={time,temperature_2m:time.map(()=>scaling.temperature_2m.mean),precipitation:time.map(()=>scaling.precipitation.mean),
  snowfall:time.map(()=>scaling.snowfall.mean),wind_speed_10m:time.map(()=>scaling.wind_speed_10m.mean)};
 const result=buildEstimateInputs(origin,profile.rows,weather,scaling);
 assert.equal(result.demand.length,168);assert.deepEqual(result.demand[167],profile.rows[3*24+10]);
 assert.equal(result.context[167].length,14);assert.deepEqual(result.context[167].slice(9,13),[0,0,0,0]);
 assert.equal(result.context[167][5],1);assert.equal(result.context[167][13],1);
 assert.equal(result.origin,'2026-11-26T15:00:00.000Z');
 assert.throws(()=>buildEstimateInputs(origin,profile.rows,{...weather,time:time.slice(1)},scaling),/cover/);
 const missing={...weather,temperature_2m:[...weather.temperature_2m]};missing.temperature_2m[167]=NaN;
 assert.throws(()=>buildEstimateInputs(origin,profile.rows,missing,scaling),/missing values/);
});
