# UrbanFlow — NYC mobility intelligence

A Next.js dashboard for NYC taxi-demand research, official subway arrivals/service alerts, construction permits, transparent taxi-fare estimation, and a Qwen RAG assistant. Vercel hosts the web frontend and API routes; the bundled Colab model runs current-date demand estimates through ONNX Runtime using a historical reference profile and recent weather. No observed current pickups are connected. A separate trusted service can supply observed live forecasts.

**Research status:** the original notebook has been corrected for future-data leakage and its outputs cleared. Archived scores in `data/research.json` are not independently reproduced. Spatial LightGBM outperformed the GNN in those scores. See [the audit](docs/AUDIT.md).

## Run the dashboard

Requires Node 24. Full activation and Windows instructions: [docs/SETUP.md](docs/SETUP.md).

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Official NYC DOT/MTA feeds work without API keys. The assistant can display cited excerpts without Qwen credentials once shared limits are configured. The private workspace also needs Supabase and an embedding provider. Enter provider secrets only in your local environment or hosting settings.

For this managed cloud's proxy, use `NODE_USE_ENV_PROXY=1 npm run dev` with Node 24; retain the supplied proxy and certificate variables. Ordinary Vercel does not need this switch.

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm start
# In another terminal:
npx playwright test
```

## Qwen RAG

For the Cloudflare free-allowance setup and exact places to paste each credential, use [docs/CREDENTIALS.md](docs/CREDENTIALS.md). Approved users can run private connection checks from `/workspace`. Existing PR #8 installations also apply `supabase/migrations/202611260002_setup_access.sql`; verify with `supabase/verify-setup.sql`.


Set `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL` and `EMBEDDING_MODEL` using the Cloudflare examples in `.env.example`. Tokens stay server-only. Other OpenAI-compatible hosts can be configured, including the original Alibaba endpoint. Provider availability and allowances depend on the account. Never use `NEXT_PUBLIC_` for a server credential.

Public retrieval and generation require shared limits: Supabase service key plus a rate-limit salt, or Upstash. Private upload/search/chat/history routes use atomic account quotas in Postgres. Missing limits fail closed. Public methodology and active alerts use lexical retrieval; personal text/Markdown uses persistent embeddings plus full-text retrieval. Structured demand values come directly from the forecast API with mode, source and target hour.

Open `/workspace` for Supabase sign-in, approved membership, private documents, semantic retrieval, opt-in history, export and deletion. Personal data lives in a private bucket and owner-scoped Postgres tables with RLS. No personal documents or chats belong in this public Git repository. Follow [the complete setup guide](docs/SETUP.md) and [the privacy design](docs/RAG_STORAGE_AND_PRIVACY.md).

## Deploy to Vercel

1. Configure Supabase, account membership, provider keys and cleanup using [docs/SETUP.md](docs/SETUP.md). Keep preview and production resources separate.
2. Import/merge the branch with Next.js, repository root and Node 24. Keep the supplied `vercel.json` install/build commands. Add `.env.example` settings in Vercel; public Supabase identity must exist before the build, all secrets stay server-only.
3. Deploy and complete the guide's API/browser/two-account checks. A build alone does not prove service credentials, current forecasting accuracy or production isolation.
4. Enable the included maintenance workflow after testing its protected endpoint. Current estimates use the bundled ONNX model without a Python host; truly observed live mode needs a separate trusted data/model service.

## Trip costs

Choose two TLC taxi zones. Select now or 1, 3, 6, 12 or 24 hours ahead in Trip costs. The dashboard recalculates the selected route for that departure using New York local time. The fare API uses the route geometry to apply the MTA relief-zone toll and estimate the state's 96th Street surcharge. Detected bridge and tunnel crossings use standard passenger E-ZPass rates. Newark quotes estimate return tolls using the outbound route and departure time. Actual addresses, the chosen route and traffic can change the fare.

Set the server-only `MAPBOX_ACCESS_TOKEN` to use Mapbox Directions. If you already have an HTTPS OSRM-compatible endpoint, `ROUTING_SERVICE_URL` takes precedence. The API requests road geometry, named steps and distance/duration annotations. Mapbox uses `driving-traffic` with the selected `depart_at`; a custom OSRM service remains a static route estimate. Routes use distinct TLC zone centers. When routing is unavailable, JFK–Manhattan can still show the flat tariff with a possible congestion range and without bridge/tunnel tolls.

The [MTA relief-zone geofence](https://data.ny.gov/d/srxy-5nxn) is stored in `data/congestion-relief-zone.json`. Crossing tariffs are based on the [MTA E-ZPass tariff](https://www.mta.info/document/186876) and [Port Authority E-ZPass rates](https://www.panynj.gov/bridges-tunnels/en/tolls.html). Review these when toll rates change.

The model forecasts hourly pickups by zone. Demand does not change the regulated fare. The bundled ONNX export already supports all five demand horizons; an external service must also provide those horizons to fill every result.

## Current-demand estimates and explicit replay

Default `FORECAST_MODE=estimate` returns all five horizons for 263 zones with a current model origin. It builds a 168-hour estimated pickup input from the historical weekly reference profile, aligns recent Open-Meteo weather and applies the original model's preprocessing. This is a clearly labeled estimate, not observed current demand or demonstrated current accuracy. The bundled reference covers one real held-out 2025 week. `scripts/export-reference-profile.py` can replace it with a full-year profile from your real hourly counts; see the setup guide. No synthetic training dataset was added.

Only `FORECAST_MODE=replay` uses the old server-only `COLAB_HISTORICAL_INPUT_GZIP` input. Old settings do not silently reactivate replay. An external service takes precedence when configured and must return the complete grid; historical service output is rejected unless replay was explicitly selected.

The hour controls remain in **Trip costs**, alongside the route. Departure refreshes fare and hourly weather. The demand context card also displays the selected pickup estimate, exact target and provenance. Demand does not create a regulated-fare surcharge. Open-Meteo weather feeds the existing FHWA-based travel-time sensitivity calculation; this is not a NYC-trained fare model. See [the weather/pricing design](docs/TRIP_WEATHER.md).

## Train, audit and serve the models

The original checkpoints, graph arrays and parquet inputs were not checked into GitHub. Recover them from the original Colab Drive or rebuild from official sources. Full-year TLC preparation downloads large monthly files and full training may require substantial CPU/GPU time.

```bash
python -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r ml/requirements-geo.txt
PYTHONPATH=ml .venv/bin/pytest ml/tests -q

# Rebuild 2025 counts and training-only graphs; deletes monthly downloads after processing.
PYTHONPATH=ml .venv/bin/python -m mobility.prepare --year 2025 --train-end 2025-10-01 --out artifacts/data

PYTHONPATH=ml .venv/bin/python -m mobility.train \
  --demand artifacts/data/demand.parquet --graphs artifacts/data/graphs.npz \
  --out artifacts/run --epochs 60

# Set MODEL_SERVICE_TOKEN privately before serving.
PYTHONPATH=ml MODEL_BUNDLE=artifacts/run .venv/bin/uvicorn mobility.service:app --host 0.0.0.0 --port 8000
```

Demand inputs are hourly timestamp-indexed parquet with TLC zone IDs as columns. Graph NPZ must contain exactly matching `zone_ids` and one or more of `A_adj`, `A_dist`, `A_od`, `A_corr`. Training exports a checkpoint and `report.json`. Service bundles require trusted provenance and periodic observed-demand updates. Old or timezone-ambiguous bundles are historical. A `ml/Dockerfile` is provided for a separate model host; mount the trusted bundle at `/app/artifacts/run` and supply the secret through that host's settings.

## Accurate interpretation

- Active service alerts are not a train timetable. Arrival predictions come separately from timestamp-checked MTA trip-update feeds.
- Construction permits are not confirmed full-road closures.
- Exposure scores are transparent geographic scenarios, not trained future closure probabilities.
- Observed live forecasts require recent observed demand. Default current-date estimates use historical reference inputs plus recent weather and must be labeled estimates. Monthly TLC records cannot establish current pickups.
- Yellow-taxi estimates include applicable airport rates and exclude tips and unspecified tolls. E-hail and rideshare services quote their own prices.

Source documentation, limitations and scientific corrections are in [docs/AUDIT.md](docs/AUDIT.md).
