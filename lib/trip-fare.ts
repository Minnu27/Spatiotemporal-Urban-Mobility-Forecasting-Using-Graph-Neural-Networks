import { z } from 'zod';
import zones from '@/data/zones.json';
import { estimateFare, meterInputs } from './fares';
import { isNewYorkHoliday } from './ny-holidays';
import { tripHorizons } from './horizons';
import { fetchJson, serverUrl } from './http';

export const quoteInput = z.object({
  pickup: z.number().int(),
  dropoff: z.number().int(),
  horizon: z.literal(tripHorizons),
  congestion: z.enum(['unknown', 'none', 'state', 'both']).default('unknown'),
  holiday: z.boolean().default(false),
  tolls: z.number().min(0).max(100).default(0),
  manual: meterInputs.optional(),
});

export const pickupZones = zones.filter(z => z.borough !== 'EWR');

const routeSchema = z.object({
  code: z.literal('Ok'),
  routes: z.array(z.object({
    distance: z.number().positive(),
    duration: z.number().positive(),
    legs: z.tuple([z.object({ annotation: z.object({
      distance: z.array(z.number().nonnegative()).min(1),
      duration: z.array(z.number().nonnegative()).min(1),
    }) })]),
  })).min(1),
});

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
});

export function findTrip(pickup: number, dropoff: number) {
  const from = pickupZones.find(z => z.id === pickup);
  const to = zones.find(z => z.id === dropoff);
  return from && to ? { from, to } : null;
}

export function usesJfkFlatRate({ from, to }: NonNullable<ReturnType<typeof findTrip>>) {
  return (from.id === 132 && to.borough === 'Manhattan') ||
    (to.id === 132 && from.borough === 'Manhattan');
}

export async function routeMeter({ from, to }: NonNullable<ReturnType<typeof findTrip>>, endpoint: string) {
  const points = [from, to].map(z => `${z.longitude},${z.latitude}`).join(';');
  const routeUrl = `${serverUrl(endpoint)}/route/v1/driving/${points}?overview=false&annotations=distance,duration`;
  const { routes: [route] } = routeSchema.parse(await fetchJson(routeUrl, {}, 500_000, 8000));
  const { distance, duration } = route.legs[0].annotation;
  if (distance.length !== duration.length) throw new Error('Invalid routing annotations');
  let fastMeters = 0;
  let slowSeconds = 0;
  distance.forEach((meters, index) => {
    const seconds = duration[index];
    if (seconds > 0 && meters >= seconds * (12 * 1609.344 / 3600)) fastMeters += meters;
    else slowSeconds += seconds;
  });
  return {
    ...meterInputs.parse({ milesAbove12mph: fastMeters / 1609.344, slowMinutes: slowSeconds / 60 }),
    miles: route.distance / 1609.344,
    minutes: route.duration / 60,
  };
}

export function calculateQuote(
  input: z.infer<typeof quoteInput>,
  trip: NonNullable<ReturnType<typeof findTrip>>,
  route: Awaited<ReturnType<typeof routeMeter>> | null,
  now = Date.now(),
) {
  const departure = new Date(now + input.horizon * 3600_000);
  const local = Object.fromEntries(nyClock.formatToParts(departure).map(part => [part.type, part.value]));
  const weekday = local.weekday !== 'Sat' && local.weekday !== 'Sun';
  const holiday = input.holiday || isNewYorkHoliday(Number(local.year), Number(local.month), Number(local.day));
  const jfkFlat = usesJfkFlatRate(trip);
  const meter = jfkFlat
    ? { milesAbove12mph: 0, slowMinutes: 0 }
    : input.manual ?? route;
  if (!meter) throw new Error('No meter inputs available');

  const base = { ...meter, localHour: Number(local.hour), weekday, holiday, tolls: input.tolls };
  const rates = {
    jfkFlat,
    airportPickup: [132, 138].includes(trip.from.id),
    laguardia: [trip.from.id, trip.to.id].includes(138),
    newarkDropoff: trip.to.borough === 'EWR',
  };
  const fare = estimateFare({
    ...base,
    south96: input.congestion === 'state' || input.congestion === 'both',
    south60: input.congestion === 'both',
  }, rates);
  const maximum = input.congestion === 'unknown'
    ? estimateFare({ ...base, south96: true, south60: true }, rates).total
    : fare.total;
  return {
    ...fare, maximum, departure: departure.toISOString(),
    basis: jfkFlat ? 'flat' as const : input.manual ? 'manual' as const : 'route' as const,
    tolls: input.tolls, newarkDropoff: rates.newarkDropoff,
    route: route && { miles: route.miles, minutes: route.minutes },
  };
}

export type TripQuote = ReturnType<typeof calculateQuote>;
