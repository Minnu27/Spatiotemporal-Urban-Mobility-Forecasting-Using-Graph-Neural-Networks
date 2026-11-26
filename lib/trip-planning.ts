import { calculateQuote, segmentMeter, type quoteInput, type findTrip, type RouteEstimate } from './trip-fare';
import { getTripWeather } from './weather';
import { weatherImpact } from './weather-impact';
import type { z } from 'zod';

export function slowRoute(route:RouteEstimate, speedReduction:number):RouteEstimate {
  if(!route.segments?.length||speedReduction<0||speedReduction>=1)throw Error('Weather model requires valid route segments');
  const segments=route.segments.map(segment=>({...segment,seconds:segment.seconds/(1-speedReduction)}));
  return {...route,...segmentMeter(segments),segments,minutes:route.minutes/(1-speedReduction)};
}

export async function planTrip(input:z.infer<typeof quoteInput>,trip:NonNullable<ReturnType<typeof findTrip>>,route:RouteEstimate|null,now:number) {
  const baseline=calculateQuote(input,trip,route,now);
  const weather=await getTripWeather(trip.from,trip.to,Date.parse(baseline.departure),now);
  const impact=weatherImpact(weather);
  let state:'applied'|'dry'|'unavailable'|'unsupported'=impact.state==='available'?'dry':impact.state;
  let scenarios:ReturnType<typeof calculateQuote>[]=[];
  let scenarioMinutes:number[]=[];
  if(impact.state==='available'&&impact.speedReduction[1]>0){
    if(!route||input.manual)state='unavailable';
    else try{
      const routes=impact.speedReduction.map(reduction=>slowRoute(route,reduction));
      scenarios=routes.map(adjusted=>calculateQuote(input,trip,adjusted,now));
      scenarioMinutes=routes.map(adjusted=>adjusted.minutes);
      state='applied';
    }catch{state='unsupported';}
  }
  const totals=[baseline.total,...scenarios.map(quote=>quote.total)];
  const maxima=[baseline.maximum,...scenarios.map(quote=>quote.maximum)];
  return {...baseline,weather,
    planningMinimum:Math.min(...totals),planningMaximum:Math.max(...maxima),
    weatherAdjustment:{...impact,state,
      fareMinimum:scenarios.length?Math.min(...scenarios.map(quote=>quote.total)):null,
      fareMaximum:scenarios.length?Math.max(...scenarios.map(quote=>quote.maximum)):null,
      minutesMinimum:scenarioMinutes[0]??null,minutesMaximum:scenarioMinutes[1]??null,
    },
  };
}
export type PlannedTrip=Awaited<ReturnType<typeof planTrip>>;
