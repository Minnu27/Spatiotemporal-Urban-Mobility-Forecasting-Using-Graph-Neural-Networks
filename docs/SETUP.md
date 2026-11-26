# Run and activate UrbanFlow

This branch contains the application, model files, database migration and scripts. It implements **current-date demand estimates**, authentication, private knowledge storage/retrieval and optional saved history. It does not provision Supabase, purchase API access, train a new model or connect observed real-time pickups.

Exact fields and copy/paste locations are in [CREDENTIALS.md](CREDENTIALS.md). Actual keys belong in Vercel or your ignored `.env.local`, never in a PR.

## 1. Install locally

Use Node **24** and Git. Clone/download this branch and open its root directory.

Windows PowerShell:

```powershell
$env:ONNXRUNTIME_NODE_INSTALL="skip"
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

macOS/Linux:

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm ci
test -f .env.local || cp .env.example .env.local
```

Edit `.env.local` locally. Keep credentials out of Git/chat and preserve existing Mapbox/provider values in Vercel. Never replace working secrets with blank examples.

## 2. Create Supabase and approve your account

1. Create a Supabase project directly or through Vercel Marketplace. Choose the region/plan. Use separate projects for preview/development and production personal data.
2. On a **fresh project**, run `supabase/migrations/202611260001_private_workspace.sql` once, then run `supabase/migrations/202611260002_setup_access.sql`. Existing PR #8 installations run only the second file. It is an idempotent access-grant repair that preserves data and RLS. Run `supabase/verify-setup.sql` afterward: all tables must exist with RLS enabled, expected function permissions must match actual permissions, and the embedding column must be vector(1024). Do not repeatedly run the initial table-creation migration on an existing database.
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
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase modern sb_secret_ key or legacy service_role JWT; server only, for archive/cleanup/anonymous limits. |
| `MAINTENANCE_TOKEN` | A new random secret for the cleanup endpoint. |
| `RATE_LIMIT_SALT` | A different random secret, at least 32 characters, for anonymous limit identifiers. |

Generate each secret separately and save its output privately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

For personal use, approve only your own account. Revoke membership with `app_members.enabled=false`; API/RLS checks it on subsequent requests. For permanent account deletion, remove its documents through the workspace/maintenance before deleting the Auth user: deleting an Auth row alone does not remove Storage objects.

## 3. Enable open Qwen models through Cloudflare

Create a Cloudflare account and open **Workers AI → Use REST API**. Use the prefilled Workers AI API-token template and copy the Account ID. Add these in Vercel Production and in your local development environment as appropriate:

```dotenv
QWEN_API_KEY=YOUR_CLOUDFLARE_WORKERS_AI_TOKEN
QWEN_BASE_URL=https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1
QWEN_MODEL=@cf/qwen/qwen3.8-27b
EMBEDDING_MODEL=@cf/qwen/qwen3-embedding-0.6b
```

Replace YOUR_ACCOUNT_ID with the 32-character Cloudflare Account ID. Include the leading @ in both model IDs. The key/base are shared with embeddings unless EMBEDDING_API_KEY / EMBEDDING_BASE_URL are set separately. Full field-by-field instructions are in [CREDENTIALS.md](CREDENTIALS.md).

The application requests 1,024-dimensional vectors and validates their shape and order. Cloudflare Qwen3.8 disables the separate thinking pass and allows 1,024 output tokens. Replies default to short conversational answers; the user can request more detail. Generation can run for up to 60 seconds inside the chat function's 180-second budget. Other compatible providers retain their request format.

Public chat accepts arbitrary questions and recent conversation context. It streams draft text, then validates the final answer's source indices; invalid source claims replace the draft with excerpts. General knowledge, greetings and clarifying questions are labeled as general conversation and carry no evidence links. Missing live/project facts must be acknowledged, never filled with guessed values. The in-page transcript follows dashboard navigation; New chat or refreshing clears it. It is not stored in localStorage or the database. At most eight recent messages and 8,000 characters are sent for context. Unsaved private conversations also send recent context; saved conversation ownership is verified before loading the owner’s database rows and combining recent unsaved exchanges. History is context, never a factual source.

Static and general questions skip live alert fetching. Alert questions retrieve feeds; weather questions retrieve the NYC zone forecast, with Midtown Center explicitly identified when no zone is named. Questions naming an exact taxi zone and supported hour can retrieve structured demand estimates. Generation, optional private retrieval and current-data calls still depend on upstream availability. No extra API key or migration is needed for this chat update.

Provider free allowances are limited; requests may be rejected after quota exhaustion. Keep provider tokens server-only and review processing/region settings before submitting personal documents. The provider connection test sends fixed non-personal text only; actual RAG sends retrieved excerpts and saved context as explained in the UI.

Supabase service key + salt supplies public limits; Upstash remains an optional public alternative. Private upload/search/chat/history and setup checks use atomic database account quotas. Missing/unavailable limits reject provider requests.

## 4. Use current-date demand estimates (profile refresh is optional)

```dotenv
FORECAST_MODE=estimate
MODEL_SERVICE_URL=
MODEL_SERVICE_TOKEN=
```

Clear an old external model-service setting if it returns historical results; configured external services take precedence. The old `COLAB_HISTORICAL_INPUT_GZIP` is ignored unless `FORECAST_MODE=replay` is explicitly selected.

The original GNN uses 168 current-date input hours built from historical hour-of-week pickup counts and recent Open-Meteo weather, with recovered training normalization. These are **estimated pickups, not observed current pickups**. Weather is recent modeled weather. No synthetic training dataset was added.

For estimate mode, the model's origin is the start of the current hour; its input includes an assumed full pickup count for that in-progress hour. A horizon predicts **one target hour**, not cumulative pickups or necessarily a departure that many hours from this instant. API/evidence show mode, source, origin and target. Trip-cost departure controls separately use the actual current time plus the selected hours.

The bundled reference is one real held-out week ending February 7, 2025: enough to run the estimate path, but a weak seasonal baseline. This setup change leaves that reference unchanged. When you choose to refresh it, run the existing exporter against your actual full-year hourly dataset in Colab or Python:

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

`check:setup` reads `.env.local` without printing secret values. It validates URL/key formats, connects to the database, checks the private bucket and public limiter, checks personal-use signup settings, and runs the current estimate. `--providers` verifies a nonzero 1,024-dimensional vector and a real nonempty chat test response; it does not accept a mere choices array as success. `--json` produces a report suitable for sharing without credentials. It cannot replace two-account deployment checks.

Open `http://localhost:3000/workspace`. After signing in, expand **Connection checks** and run the check. If login itself fails, use the local checker or SQL verification first. The AI checkbox explicitly approves two fixed-text provider requests; it is off by default. The endpoint requires an approved session, matching Origin and account quota before provider calls. Repair any failed item using its displayed action.

Then use the workspace. Sign in, upload a harmless .txt/.md file after checking consent, and ask something unique to that file. The optional Search archived alerts setting retrieves saved source snapshots with explicit historical labels. Saving is off by default. Enable Save for new exchanges; reload, reopen and export/delete that conversation. Documents and opted-in chats persist across redeploys in Supabase.

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

## 7. Deploy the follow-up

PR #8 is already merged; merge the follow-up change after reviewing it and setting the matching Vercel environment. Keep Node 24, Next.js, repository-root build, and the supplied `vercel.json` install/build commands. Both `NEXT_PUBLIC_SUPABASE_*` settings must exist **before the build**; redeploy after changing them. Server-only settings must be present in the deployment environment. Preserve working routing tokens.

Repeat section 5 after deployment. A successful build does not activate a database/provider/scheduler. For an entirely personal-only website, additionally enable Vercel deployment protection on every alias: application login protects personal data, while mobility pages remain public.

## Files to run or configure

| File | Action |
| --- | --- |
| `.env.example` | Copy to .env.local; fill settings privately. |
| `supabase/migrations/202611260001_private_workspace.sql` | Fresh project only: run once. |
| `supabase/migrations/202611260002_setup_access.sql` | Existing PR #8 and fresh projects: apply access grants; safe to rerun. |
| `supabase/verify-setup.sql` | Read-only schema/RLS/function checks in SQL Editor. |
| `docs/CREDENTIALS.md` | Exact names, values and paste locations; never put key values in PRs. |
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
