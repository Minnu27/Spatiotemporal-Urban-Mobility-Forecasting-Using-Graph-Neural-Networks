import { z } from 'zod';
export const fareSchema = z.object({
  milesAbove12mph:z.number().min(0).max(100), slowMinutes:z.number().min(0).max(180),
  localHour:z.number().int().min(0).max(23), weekday:z.boolean(), holiday:z.boolean(),
  south96:z.boolean(), south60:z.boolean(), tolls:z.number().min(0).max(100).default(0),
});
export type FareInput = z.infer<typeof fareSchema>;
export function estimateFare(raw: FareInput) {
  const v=fareSchema.parse(raw);
  const breakdown=[{label:'Initial charge',amount:3},{label:'Distance above 12 mph',amount:Math.ceil(v.milesAbove12mph*5)*0.7},
    {label:'Slow / stopped time',amount:Math.ceil(v.slowMinutes)*0.7},{label:'MTA state surcharge',amount:0.5},{label:'Improvement surcharge',amount:1},
    {label:'Overnight (8pm–6am)',amount:v.localHour>=20||v.localHour<6?1:0},
    {label:'Weekday rush hour',amount:v.weekday&&!v.holiday&&v.localHour>=16&&v.localHour<20?2.5:0},
    {label:'South of 96th St',amount:v.south96||v.south60?2.5:0},{label:'Congestion Relief Zone',amount:v.south60?0.75:0},{label:'Other tolls',amount:v.tolls}];
  return {total:Math.round(breakdown.reduce((s,b)=>s+b.amount,0)*100)/100,breakdown,
    source:'https://www.nyc.gov/site/tlc/passengers/taxi-fare.page',
    disclaimer:'Illustrative NYC yellow-taxi metered fare, excluding tip. Distance must exclude travel during slow/stopped minutes to avoid double counting. Airport flat fares, airport surcharges and out-of-city rates are excluded. This is not an e-hail or rideshare quote.'};
}
