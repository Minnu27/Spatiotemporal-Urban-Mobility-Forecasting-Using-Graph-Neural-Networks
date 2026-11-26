# Departure-time trip estimates and weather

Trip costs owns the departure selector: **now, 1, 3, 6, 12 and 24 hours ahead**. There is no forecast selector on Overview. Pick two TLC taxi zones, then choose the departure to refresh route distance/time, weather and estimated cost. Zones use representative centers, not exact street addresses.

## Data flow

1. The client posts `{pickup, dropoff, horizon}` to `/api/fare`. Only supported integer horizons are accepted. A new selection aborts the previous client request; results are keyed by route, horizon and retry so a slow response cannot overwrite a different trip.
2. The server captures one time and adds elapsed hours to calculate departure. Mapbox Directions uses `driving-traffic` and that exact `depart_at`, with segment distance/duration annotations. Live and historical traffic support the provider's departure-time estimate. Custom OSRM services have no departure-time traffic forecast and are labeled static.
3. Open-Meteo hourly forecasts are requested server-side for both zone centers with explicit Celsius, millimeters, centimeters and km/h units. Unix timestamps avoid ambiguous local dates during DST changes. The selected weather bucket contains departure, with no substitution of today's or the nearest available hour.
4. Published taxi rates, departure-local rush/overnight/holiday rules and detected route tolls produce the baseline quote. Weather does not change the tariff.
5. `weather-impact.ts` maps rain, snow or fog forecasts into a transparent speed sensitivity scenario. `slowRoute()` recalculates each segment's duration, reclassifies travel above/below 12 mph, and passes the resulting distance/slow time through the same meter calculation. The UI shows the baseline and an envelope containing it and the weather scenarios. This envelope is **not** a statistical confidence interval.

## Weather model scope

The scenario uses FHWA's published average freeway-speed reductions: light rain/snow 3–13%, heavy rain 3–16%, heavy snow 5–40%, and fog 10–12%. WMO weather codes select the corresponding condition; precipitation/snowfall provide additional wet/snow signals. The larger supported endpoint impact is applied to the route as a sensitivity assumption. This is not a calibrated estimate for NYC local streets and cannot establish the weather along every road segment. Traffic estimates can already contain weather-related delay; the envelope is a planning sensitivity rather than a correction that is known to be missing from Mapbox.

Temperature and wind are shown as context; there is no unsupported temperature/wind fare coefficient. Freezing precipitation, rime fog, thunderstorms/hail and unknown codes return an unsupported adjustment state rather than a fabricated surcharge. Missing/null weather at either endpoint prevents a full route weather adjustment. Dry supported conditions produce no weather adjustment. Excessive modeled slow time outside the estimator's input bounds also leaves the baseline intact.

JFK–Manhattan uses a flat tariff. Weather can increase the displayed travel-time sensitivity without increasing that flat fare. Departure-based surcharges and detected route tolls can still differ. Equal prices across two horizons are a valid outcome.

## Relationship to the trained GNN

The bundled ONNX model predicts zone pickup counts using 168 hours of observed demand and context, including weather history. Historical replay uses a fixed 2025 observation window. Current-date estimate mode instead builds a fully date-aligned assumed pickup window and recent weather using the original scaling; it labels those pickups as estimates and does not establish current accuracy. It has no trip-duration or fare output and does not consume future weather as a separate input tensor. Replacing weather alone while retaining a historical origin would mix dates; estimate mode explicitly rebuilds and dates the entire assumed input window.

This implementation therefore connects live forecast weather to an explicit **travel-time sensitivity model**, followed by the regulated meter. It does not relabel GNN pickup predictions as fares or claim that the scenario is a learned weather-price model. A trained replacement requires observed trip durations by route/time, weather forecasts available at each historical issue time, a chronological evaluation, exported feature transforms and a validated inference artifact. Reanalysis weather alone would not measure real forecast-time performance. The present adapter boundary is `planTrip()`/`slowRoute()`.

## Availability and configuration

Weather uses the public Open-Meteo noncommercial endpoint by default. For commercial access, configure the server-only `OPEN_METEO_API_KEY`; the application then uses the provider's customer endpoint. Pricing/access terms are set by Open-Meteo. Mapbox continues to use the existing server-only `MAPBOX_ACCESS_TOKEN`; the traffic profile may have different account usage/cost implications from basic driving directions.

Weather responses are schema/unit checked, bounded to 100 KB and a five-second request timeout. Successful location grids are cached for ten minutes, with at most 64 entries per function instance; failures are not retained. The UI labels retrieval time separately from the target forecast hour. The cache is an optimization and does not promise shared or durable state. Weather outages do not fail an otherwise valid fare. Routing failure still returns an explicit error as before. The fare function has a 30-second deployment limit and the client a 20-second request deadline.

No customer address or private geolocation is requested. Weather calls contain public zone-center coordinates. Responses use `Cache-Control: no-store`. Provider keys stay server-side. The browser only receives weather/quote results.

## Verification

Tests cover hour selection across midnight, missing/null data and invalid units, API departure alignment, weather-to-meter propagation, the 12 mph boundary, unsupported conditions, provider failures and unchanged flat fares. Browser regression tests check that selectors exist only in Trip costs, send each requested horizon and update the price/weather without overflowing a mobile viewport. Any unexecuted browser checks must be reported separately from passing domain/API tests.

## Sources

- [Open-Meteo hourly forecast API and WMO codes](https://open-meteo.com/en/docs)
- [Open-Meteo pricing and access](https://open-meteo.com/en/pricing)
- [Mapbox Directions profiles and departure time](https://docs.mapbox.com/api/navigation/directions/)
- [FHWA weather impacts on road mobility](https://ops.fhwa.dot.gov/weather/roadimpact.htm)
- [NYC TLC taxi fare rules](https://www.nyc.gov/site/tlc/passengers/taxi-fare.page)
