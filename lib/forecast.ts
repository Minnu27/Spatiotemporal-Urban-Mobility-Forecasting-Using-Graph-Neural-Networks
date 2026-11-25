import { maxForecastHorizon } from './horizons';
import { getHistoricalForecast } from './onnx-forecast';
import { z } from 'zod';
import { fetchJson, serverUrl } from './http';
import type { Forecast } from './types';
const schema=z.object({mode:z.enum(['historical','live']),model:z.string(),issuedAt:z.iso.datetime({offset:true}),historySource:z.string(),rows:z.array(z.object({zoneId:z.number().int().min(1).max(263),horizon:z.number().int().min(1).max(maxForecastHorizon),value:z.number().finite().min(0)})).max(263 * maxForecastHorizon),message:z.string()});
export async function getForecast():Promise<Forecast> {
  const unavailable:Forecast={mode:'unavailable',model:null,issuedAt:new Date().toISOString(),historySource:null,rows:[],message:'Connect a trained model and recent observed demand to enable forecasts. Saved notebook metrics are available in Research.'};
  if (!process.env.MODEL_SERVICE_URL || !process.env.MODEL_SERVICE_TOKEN) {
    if (!process.env.COLAB_HISTORICAL_INPUT_GZIP) return unavailable;
    try { return await getHistoricalForecast(); }
    catch (error) {
      console.error('Historical ONNX forecast failed', error);
      return {...unavailable, message:'The historical model could not be loaded.'};
    }
  }
  try { const data=schema.parse(await fetchJson(serverUrl(process.env.MODEL_SERVICE_URL)+'/forecast',{headers:{Authorization:`Bearer ${process.env.MODEL_SERVICE_TOKEN}`}}));
    if(data.mode==='live' && (Date.now()-Date.parse(data.issuedAt)>90*60_000 || Date.parse(data.issuedAt)>Date.now()+60_000)) return {...unavailable,message:'Model service returned a stale or future-dated live forecast.'};
    return data;
  } catch { return {...unavailable,message:'The model service is unavailable or returned an invalid forecast. Please try again later.'}; }
}
