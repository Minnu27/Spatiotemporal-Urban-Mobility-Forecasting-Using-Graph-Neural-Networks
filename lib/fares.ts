import { z } from 'zod';

export const fareSource = 'https://www.nyc.gov/site/tlc/passengers/taxi-fare.page';

export const meterInputs = z.object({
  milesAbove12mph: z.number().min(0).max(100),
  slowMinutes: z.number().min(0).max(180),
});

export const fareSchema = meterInputs.extend({
  localHour: z.number().int().min(0).max(23),
  weekday: z.boolean(),
  holiday: z.boolean(),
  south96: z.boolean(),
  south60: z.boolean(),
  tolls: z.number().min(0).max(100).default(0),
});

export type FareInput = z.infer<typeof fareSchema>;

type TripRates = {
  jfkFlat?: boolean;
  airportPickup?: boolean;
  laguardia?: boolean;
  newarkDropoff?: boolean;
};

export function estimateFare(raw: FareInput, trip: TripRates = {}) {
  const v = fareSchema.parse(raw);
  // TLC §58-26 combines fractional distance and time before rounding.
  const units = Math.ceil(Number((v.milesAbove12mph * 5 + v.slowMinutes).toFixed(10)));
  const rushHour = v.weekday && !v.holiday && v.localHour >= 16 && v.localHour < 20;
  const overnight = v.localHour >= 20 || v.localHour < 6;
  const charges: [string, number][] = [
    [trip.jfkFlat ? 'JFK–Manhattan flat fare' : 'Initial charge', trip.jfkFlat ? 7000 : 300],
    ['Metered distance and slow time', trip.jfkFlat ? 0 : units * 70],
    ['MTA state surcharge', trip.newarkDropoff ? 0 : 50],
    ['Improvement surcharge', 100],
    ['Overnight surcharge', !trip.jfkFlat && overnight ? 100 : 0],
    ['Weekday rush hour', rushHour ? (trip.jfkFlat ? 500 : 250) : 0],
    ['State congestion surcharge', v.south96 || v.south60 ? 250 : 0],
    ['Congestion Relief Zone toll', v.south60 ? 75 : 0],
    ['Airport pickup fee', trip.airportPickup ? 200 : 0],
    ['LaGuardia surcharge', trip.laguardia ? 500 : 0],
    ['Newark surcharge', trip.newarkDropoff ? 2000 : 0],
    ['Other tolls', Math.round(v.tolls * 100)],
  ];

  return {
    total: charges.reduce((total, [, cents]) => total + cents, 0) / 100,
    breakdown: charges.filter(([, cents]) => cents > 0).map(([label, cents]) => ({ label, amount: cents / 100 })),
    source: fareSource,
  };
}
