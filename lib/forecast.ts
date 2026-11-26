import { maxForecastHorizon } from './horizons';
import { getHistoricalForecast } from './onnx-forecast';
import { getCurrentEstimate } from './current-estimate';
import { z } from 'zod';
import { fetchJson, serverUrl } from './http';
import type { Forecast } from './types';
const schema=z.object({mode:z.enum(['historical','live']),model:z.string(),issuedAt:z.iso.datetime({offset:true}),historySource:z.string(),rows:z.array(z.object({zoneId:z.number().int().min(1).max(263),horizon:z.literal([1,3,6,12,24]),value:z.number().finite().min(0)})).length(263*5),message:z.string()})
 .refine(value=>new Set(value.rows.map(row=>`${row.zoneId}:${row.horizon}`)).size===263*5);
export async function getForecast():Promise<Forecast> {
  const unavailable:Forecast={mode:'unavailable',model:null,issuedAt:new Date().toISOString(),historySource:null,rows:[],message:'Connect a trained model and recent observed demand to enable forecasts. Saved notebook metrics are available in Research.'};
  if (!process.env.MODEL_SERVICE_URL || !process.env.MODEL_SERVICE_TOKEN) {
    try {
      if(process.env.FORECAST_MODE==='replay')return await getHistoricalForecast();
      if(process.env.FORECAST_MODE==='live')return {...unavailable,message:'Live mode requires a service with recent observed pickups. Historical replay is disabled.'};
      return await getCurrentEstimate();
    }catch{return {...unavailable,message:'The current demand estimate could not be generated. Check the model files and recent-weather provider.'};}
  }
  try { const data=schema.parse(await fetchJson(serverUrl(process.env.MODEL_SERVICE_URL)+'/forecast',{headers:{Authorization:`Bearer ${process.env.MODEL_SERVICE_TOKEN}`}}));
    if(data.mode==='live' && (Date.now()-Date.parse(data.issuedAt)>90*60_000 || Date.parse(data.issuedAt)>Date.now()+60_000)) return {...unavailable,message:'Model service returned a stale or future-dated live forecast.'};
    if(data.mode!=='live'&&process.env.FORECAST_MODE!=='replay')return {...unavailable,message:'The external service returned historical data; it is not accepted as current demand.'};
    return data;
  } catch { return {...unavailable,message:'The model service is unavailable or returned an invalid forecast. Please try again later.'}; }
}
