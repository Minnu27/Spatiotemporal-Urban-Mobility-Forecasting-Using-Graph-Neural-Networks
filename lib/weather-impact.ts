import type { TripWeather, WeatherHour } from './weather';

export const weatherImpactSource = 'https://ops.fhwa.dot.gov/weather/roadimpact.htm';
export type WeatherImpact = {
  model:'fhwa-speed-sensitivity-v1'; kind:'scenario'; state:'available'|'unavailable'|'unsupported';
  condition:string; speedReduction:[number,number]; source:string; note:string;
};

// Published average freeway-speed ranges are a sensitivity scenario, not a
// NYC-trained model, a probability interval or an additional taxi tariff.
function reduction(hour:WeatherHour): [number,number] | null {
  if([48,56,57,66,67,95,96,99].includes(hour.code))return null;
  if([75,86].includes(hour.code))return [0.05,0.40];
  if(hour.snowfallCm>0 || [71,73,77,85].includes(hour.code))return [0.03,0.13];
  if([65,82].includes(hour.code))return [0.03,0.16];
  if(hour.precipitationMm>0 || [51,53,55,61,63,80,81].includes(hour.code))return [0.03,0.13];
  if(hour.code===45)return [0.10,0.12];
  if([0,1,2,3].includes(hour.code))return [0,0];
  return null;
}

export function weatherImpact(weather:TripWeather):WeatherImpact {
  const base={model:'fhwa-speed-sensitivity-v1' as const,kind:'scenario' as const,source:weatherImpactSource,
    note:'Sensitivity scenario from published freeway studies; not calibrated for NYC streets. Traffic may already reflect weather. Temperature and wind are context only.'};
  if(!weather.pickup||!weather.dropoff)return {...base,state:'unavailable',condition:'Weather incomplete',speedReduction:[0,0]};
  const hours=[weather.pickup,weather.dropoff];const ranges=hours.map(reduction);
  if(ranges.some(range=>range===null))return {...base,state:'unsupported',condition:'No calibrated adjustment for these conditions',speedReduction:[0,0]};
  const index=ranges[1]![1]>ranges[0]![1]?1:0;
  return {...base,state:'available',condition:hours[index].condition,speedReduction:ranges[index]!};
}
