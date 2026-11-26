# Run and activate UrbanFlow

This branch contains the application, model files, database migration and scripts. It implements **current-date demand estimates**, authentication, private knowledge storage/retrieval and optional saved history. It does not provision Supabase, purchase API access, train a new model or connect observed real-time pickups.

## 1. Install locally

Use Node **24** and Git. Clone/download this branch and open its root directory.

Windows PowerShell:

```powershell
$env:ONNXRUNTIME_NODE_INSTALL="skip"
npm ci
Copy-Item .env.example .env.local
```

macOS/Linux:

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm ci
cp .env.example .env.local
```

Edit `.env.local` locally. Keep credentials out of Git/chat and preserve existing Mapbox/provider values in Vercel. Never replace working secrets with blank examples.

## 2. Create Supabase and approve your account

1. Create a Supabase project directly or through Vercel Marketplace. Choose the region/plan. Use separate projects for preview/development and production personal data.
2. In its **SQL Editor**, run the complete file `supabase/migrations/202611260001_private_workspace.sql` once on a **fresh project**. This creates pgvector, tables/functions/RLS and the private `rag-private` Storage bucket. Do not repeatedly run the migration or delete an existing database to resolve errors.
3. In **Authentication → Users**, create your email/password account. Disable public signup and anonymous sign-ins in Authentication settings; configure password/rate-limit protections and the actual site URL. This app uses password login, with no OAuth callback requirement.
4. Copy that user's UUID, substitute it below, and run:

```sql
insert into public.app_members(user_id, enabled)
values ('YOUR-AUTH-USER-UUID'::uuid, true)
on conflict(user_id) do update set enabled=true;
```

5. Fill these settings in `.env.local` and Vercel **Settings → Environment Variables**, for the matching environment:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL; public configuration. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key; legacy anon key also works. Requires the RLS policies above. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase legacy service_role API key; server only, for archive/cleanup/anonymous limits. |
| `MAINTENANCE_TOKEN` | A new random secret for the cleanup endpoint. |
| `RATE_LIMIT_SALT` | A different random secret, at least 32 characters, for anonymous limit identifiers. |

Generate each secret separately and save its output privately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

For personal use, approve only your own account. Revoke membership with `app_members.enabled=false`; API/RLS checks it on subsequent requests. For permanent account deletion, remove its documents through the workspace/maintenance before deleting the Auth user: deleting an Auth row alone does not remove Storage objects.

## 3. Enable embeddings and Qwen

Enable the relevant models in your Alibaba Cloud Model Studio account/region, then configure:

```dotenv
QWEN_API_KEY=YOUR_SERVER_KEY
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
EMBEDDING_MODEL=text-embedding-v4
```

Optionally set `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` separately; otherwise they reuse the Qwen key/base. Embeddings are **1,024-dimensional**. Changing the dimension requires a migration and rebuilding stored vectors. Changing the model/provider requires re-embedding documents; use a distinct model identifier for each provider/version. A chat model is not an embedding model.

Without Qwen, the app uses cited source excerpts. Personal ingestion/search still needs an embedding key. Public chat requires shared limits even for excerpts: Supabase service key + salt is sufficient; Upstash URL/token is an optional alternative. Private quotas always use Postgres. Missing/unavailable limits reject requests before provider calls.

Review external-provider data handling and region before using personal information. Uploaded text goes to the embedding provider; Qwen receives the question, matching excerpts and recent saved conversation context. The application does not configure provider retention.

## 4. Use current-date demand estimates

```dotenv
FORECAST_MODE=estimate
MODEL_SERVICE_URL=
MODEL_SERVICE_TOKEN=
```

Clear an old external model-service setting if it returns historical results; configured external services take precedence. The old `COLAB_HISTORICAL_INPUT_GZIP` is ignored unless `FORECAST_MODE=replay` is explicitly selected.

The original GNN uses 168 current-date input hours built from historical hour-of-week pickup counts and recent Open-Meteo weather, with recovered training normalization. These are **estimated pickups, not observed current pickups**. Weather is recent modeled weather. No synthetic training dataset was added.

For estimate mode, the model's origin is the start of the current hour; its input includes an assumed full pickup count for that in-progress hour. A horizon predicts **one target hour**, not cumulative pickups or necessarily a departure that many hours from this instant. API/evidence show mode, source, origin and target. Trip-cost departure controls separately use the actual current time plus the selected hours.

The bundled reference is one real held-out week ending February 7, 2025: enough to run the estimate path, but a weak seasonal baseline. Replace it with your actual full-year hourly dataset in Colab or Python:

```bash
python -m pip install pandas numpy pyarrow
python scripts/export-reference-profile.py \
  --demand /path/to/demand2025_clean.parquet \
  --before 2026-01-01 --require-months 12 --min-samples 4 \
  --out model/reference-profile.json
```

PowerShell: put that Python command on one line instead of using backslashes. Input must have a DatetimeIndex or timestamp column plus zone columns named 1 through 263 matching `model/metadata.json`. CSV supports `--timestamp-column YOUR_COLUMN`. Naive timestamps default to New York; use `--timezone UTC` if the source is UTC. The script validates real counts, all zones, 12 calendar months and sample coverage; missing cells are excluded, never fabricated. Do not turn row numbers into timestamps. The repository's `ml/mobility/prepare.py` can rebuild real official hourly counts if needed (large download).

Commit the regenerated **aggregate** `model/reference-profile.json` and redeploy; keep raw personal trips out of Git. This updates the baseline, not the trained weights or their validation. Measure prospective errors against subsequently observed counts before claiming current accuracy. Truly observed live mode requires a trusted fresh-pickup service returning all 263 × 5 rows; delayed monthly TLC records do not establish present pickups.

## 5. Run and test

```bash
npm run typecheck
npm test
npm run check:setup
# Optional: two small provider requests, which may incur charges
npm run check:setup -- --providers
npm run build
npm start
```

Use `npm run dev` for development. Only in the managed cloud proxy environment, prefix Node commands with `NODE_USE_ENV_PROXY=1`; normal local/Vercel deployments do not need it.

`check:setup` reads `.env.local` and reports names/status without secret values. It checks migrated tables, private bucket, public limiter and the current estimate. It cannot replace sign-in and two-account deployment checks.

Open `http://localhost:3000/workspace`. Sign in, upload a harmless .txt/.md file after checking consent, and ask something unique to that file. The optional Search archived alerts setting retrieves saved source snapshots with explicit historical labels. Saving is off by default. Enable Save for new exchanges; reload, reopen and export/delete that conversation. Documents and opted-in chats persist across redeploys in Supabase.

| Acceptance check | Expected result |
| --- | --- |
| `/api/health` | Estimate mode/current origin; flags reflect configuration only, not verified provider credentials. |
| `/api/forecast` | 1,315 finite rows and five horizons, with explicit estimated inputs/source. |
| Trip costs | Pickup/drop-off and Now/+1/+3/+6/+12/+24 buttons recalculate route, fare and target-hour weather. No Overview horizon selector. |
| No login | Private APIs reject document/history access. |
| Accounts A/B | Temporarily approve B. B cannot list/search/download/export/delete/attach A's IDs, including direct Supabase REST/Storage access. |
| Ingestion/reuse | Upload indexes; unchanged content reuses stored vectors; reload/redeploy preserves data. Changed content is a new document; delete the superseded version. |
| Saving | Only opted-in subsequent exchanges are written; new chats start unsaved. Earlier unsaved turns are not retroactively saved. |
| Deletion | Original/chunks/vectors disappear; saved answers may retain excerpts, so delete those conversations separately. |
| Limits/outages | Excess requests return 429; missing limiter fails closed; Qwen failure returns sources; embedding failure reports unavailable personal retrieval. |
| Feeds | MTA/DOT show real availability; Citizen appears only if an authorized adapter is configured. |

Automated SQL tests use a real non-owner PostgreSQL role through PGlite. They do not verify your actual cloud credentials, defaults, backups or provider quality. Complete the acceptance checks on the deployed URL before calling all services operational.

## 6. Schedule cleanup and archival

Set `URBANFLOW_URL=https://YOUR-DEPLOYMENT` locally and run:

```bash
npm run maintenance
```

This authenticates a POST to `/api/maintenance`. It removes up to 50 expired/failed documents per run, cascades chunks/vectors, deletes expired chat/archive data and refreshes official alerts. Storage deletion must succeed before deleting the document row. Orphan objects from account deletion/direct uploads and abandoned indexing jobs are also cleaned after one hour. Retry partial failures/backlogs.

To enable the included hourly GitHub Actions workflow, set repository **Settings → Secrets and variables → Actions**:

- Variable `URBANFLOW_URL`: production HTTPS URL.
- Secret `MAINTENANCE_TOKEN`: the production server's exact maintenance token.
- Variable `URBANFLOW_MAINTENANCE_ENABLED`: `true`, after testing the endpoint.

Enable Actions, run **Private data maintenance → Run workflow** once and monitor success. Scheduled Actions can be delayed/disabled on inactive public repositories; they are not a precise timer guarantee. If deployment protection blocks the endpoint, use an authorized trusted scheduler; do not put a long-lived bypass secret in this public repository. You can run the same command from a trusted local scheduler instead.

Documents expire 90 days after creation, conversations 30 days after creation, archive snapshots 30 days after last refresh. New chat exchanges do not extend conversation expiry. Expired data is excluded from retrieval immediately; physical objects require cleanup, and provider backups have separate retention. Archive sampling cannot recover changes missed during outages.

## 7. Deploy

Merge this branch after setting the matching Vercel environment. Keep Node 24, Next.js, repository-root build, and the supplied `vercel.json` install/build commands. Both `NEXT_PUBLIC_SUPABASE_*` settings must exist **before the build**; redeploy after changing them. Server-only settings must be present in the deployment environment. Preserve working routing tokens.

Repeat section 5 after deployment. A successful build does not activate a database/provider/scheduler. For an entirely personal-only website, additionally enable Vercel deployment protection on every alias: application login protects personal data, while mobility pages remain public.

## Files to run or configure

| File | Action |
| --- | --- |
| `.env.example` | Copy to .env.local; fill settings privately. |
| `supabase/migrations/202611260001_private_workspace.sql` | Run once in the fresh Supabase SQL Editor. |
| `scripts/check-setup.ts` | Run npm run check:setup; optional -- --providers. |
| `scripts/export-reference-profile.py` | Run against real full-year hourly counts; commit aggregate output. |
| `scripts/maintenance.mjs` | Run npm run maintenance or schedule it. |
| `.github/workflows/maintenance.yml` | Enable with the repository variable/secret above. |
| `model/forecast.onnx`, `metadata.json`, `preprocessing.json`, `reference-profile.json` | Keep together; no Python server needed for estimate mode. |
| `package.json`, `package-lock.json`, `app/`, `components/`, `lib/`, `data/` | Next.js app; install, build and start from its root. |

## Provider references

- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Hybrid retrieval](https://supabase.com/docs/guides/ai/hybrid-search)
- [Storage authorization](https://supabase.com/docs/guides/storage/security/access-control)
- [Alibaba embeddings](https://www.alibabacloud.com/help/en/model-studio/text-embedding-synchronous-api)
- [TLC trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
- [GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
