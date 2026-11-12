# UrbanFlow — NYC mobility intelligence

A Next.js dashboard for NYC taxi-demand research, official subway arrivals/service alerts, construction permits, transparent taxi-fare estimation, and a Qwen RAG assistant. Vercel hosts the web frontend and API routes; a separate Python service handles PyTorch inference.

**Research status:** the original notebook has been corrected for future-data leakage and its outputs cleared. Archived scores in `data/research.json` are not independently reproduced. Spatial LightGBM outperformed the GNN in those scores. See [the audit](docs/AUDIT.md).

## Run the dashboard

Requires Node 22+.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Official NYC DOT/MTA feeds work without API keys. The assistant retrieves and displays cited source excerpts without Qwen credentials. Enter provider secrets only in your local environment or hosting settings.

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

Set `QWEN_API_KEY`, `QWEN_BASE_URL` and `QWEN_MODEL`. Defaults target Alibaba Cloud Model Studio's international OpenAI-compatible endpoint and `qwen-plus`. Provider availability is account/region dependent; another OpenAI-compatible host can be configured. Do not use `NEXT_PUBLIC_` for any credential.

Production paid generation also requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Limits are atomic across Vercel instances (15 requests/minute/IP); a missing limiter disables paid generation. Retrieval draws from versioned methodology/research/fare documents plus current official alerts with URLs and timestamps. Answers cite retrieved evidence. Arrival predictions are requested through the station selector and are not invented by the assistant.

## Deploy to Vercel

1. Import this GitHub repository in Vercel. Select this branch or merge the reviewed change first. Framework: **Next.js**, root: repository root, install: `npm ci`, build: `npm run build`. Choose Node 24 for parity with validation (Node 22+ supported).
2. Add the server-only variables from `.env.example`. Only Qwen and the shared limiter need credentials for generated answers; NYC DOT and MTA do not. Leave optional model/Citizen variables empty until those services exist.
3. Deploy. Validate `/api/health`, `/api/alerts`, `/api/arrivals?station=127`, `/api/forecast` and the chatbot. A successful health route verifies the app, not third-party availability. An unconfigured forecast is explicitly unavailable, not sample data.
4. Use a separate persistent Python host (Render, Railway, a VM, or equivalent) for PyTorch. Vercel is not used for GPU training or checkpoint loading. Set `MODEL_SERVICE_URL` and a matching `MODEL_SERVICE_TOKEN` after that service is available.

This repository includes `vercel.json`; no Vercel account credentials or deployment IDs are embedded. A live deployment requires an authenticated Vercel account.

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
- Taxi-demand forecasts require model artifacts **and recent observed demand**. Monthly TLC records alone cannot provide real-time taxi demand.
- Metered yellow-taxi estimates are not airport fares, binding e-hail quotes, or Uber/Lyft surge prices.

Source documentation, limitations and scientific corrections are in [docs/AUDIT.md](docs/AUDIT.md).
