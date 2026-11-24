import { calculateQuote, findTrip, quoteInput, routeMeter, usesJfkFlatRate } from '@/lib/trip-fare';

export const dynamic = 'force-dynamic';

function reply(data: object, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const now = Date.now();
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (origin && URL.parse(origin)?.host !== host) return reply({ error: 'Cross-origin request rejected.' }, 403);
  if (Number(request.headers.get('content-length')) > 2048) return reply({ error: 'Fare request too large.' }, 413);
  const body = await request.text().catch(() => '');
  if (body.length > 2048) return reply({ error: 'Fare request too large.' }, 413);
  let json: unknown;
  try { json = JSON.parse(body); } catch { return reply({ error: 'Send a valid JSON fare request.' }, 400); }
  const parsed = quoteInput.safeParse(json);
  if (!parsed.success) return reply({ error: 'Choose a valid pickup and drop-off.' }, 400);

  const input = parsed.data;
  const trip = findTrip(input.pickup, input.dropoff);
  if (!trip) return reply({ error: 'Select a pickup in NYC and a supported drop-off.' }, 400);

  if (input.manual) return reply(calculateQuote(input, trip, null, now));
  if (input.pickup === input.dropoff) {
    return reply({ error: 'Choose a different drop-off zone. A zone-to-zone estimate needs two distinct locations.' }, 422);
  }
  const endpoint = process.env.ROUTING_SERVICE_URL;
  if (!endpoint && usesJfkFlatRate(trip)) return reply(calculateQuote(input, trip, null, now));
  if (!endpoint) return reply({ error: 'Route estimates are temporarily unavailable.' }, 503);

  try {
    const route = await routeMeter(trip, endpoint);
    return reply(calculateQuote(input, trip, route, now));
  } catch {
    return reply({ error: 'A road route was unavailable. Try again or choose another location.' }, 502);
  }
}
