# Where to paste credentials

Actual API keys go in **Vercel environment variables** and, for local development, your ignored **.env.local** file. PR descriptions, comments, source files and screenshots must contain placeholders only.

## Vercel

Open the Vercel project connected to this repository → **Settings → Environment Variables → Add**.

Enter the **Name / Key** and **Value** in separate fields. For the live site select **Production**. Save every entry, then redeploy; NEXT_PUBLIC variables are embedded during the build.

| Name / Key | Value to paste | Where to obtain it |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | https://YOUR_PROJECT_REF.supabase.co | Supabase project → Connect → Project URL. Copy the API URL, not the browser address containing /dashboard/project/. |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Your sb_publishable_ key | Supabase → Project Settings → API Keys → Publishable key. |
| SUPABASE_SERVICE_ROLE_KEY | Your sb_secret_ key, or legacy service_role JWT | Supabase → Project Settings → API Keys → Secret keys. The existing variable name accepts modern secret keys. |
| QWEN_API_KEY | Your Cloudflare Workers AI API token | Cloudflare → Workers AI → Use REST API → Create a Workers AI API Token. |
| QWEN_BASE_URL | https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1 | Replace YOUR_ACCOUNT_ID with the Account ID shown in Workers AI → Use REST API. |
| QWEN_MODEL | @cf/qwen/qwen3.8-27b | Paste this literal model ID, including the leading @. |
| EMBEDDING_MODEL | @cf/qwen/qwen3-embedding-0.6b | Paste this literal model ID, including the leading @. |
| MAINTENANCE_TOKEN | A separately generated random secret | Generate privately with the command below; also save the exact same value as the GitHub Actions secret. |
| RATE_LIMIT_SALT | A different random secret, at least 32 characters | Generate separately with the same command. |

The shared Cloudflare setup reuses QWEN_API_KEY and QWEN_BASE_URL for embeddings. Leave EMBEDDING_API_KEY and EMBEDDING_BASE_URL empty unless intentionally using a separate embedding provider. Keep existing MAPBOX_ACCESS_TOKEN for routed fares.

Model IDs and URLs are plain text values. **Copying a file path or uploading a file does not configure an environment variable.** Do not include the variable name or an equals sign in Vercel's Value field.

Generate MAINTENANCE_TOKEN and RATE_LIMIT_SALT separately, and save each output privately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Only the two NEXT_PUBLIC settings are browser configuration. Store all server keys/tokens as Secret/Sensitive variables. A private server key must never be put in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.

Preview deployments need a separate Supabase project and their own Preview environment settings. Production-only variables are not inherited by Preview. Keep production personal data out of preview resources.

## Local .env.local

Use Node 24. From the repository root in Windows PowerShell, create the file only if it does not exist:

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Open .env.local in your editor and fill the same variable names using your development project/provider settings. Here you use NAME=value syntax, for example:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=PASTE_YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=PASTE_YOUR_SERVER_SECRET_KEY
QWEN_API_KEY=PASTE_YOUR_CLOUDFLARE_WORKERS_AI_TOKEN
QWEN_BASE_URL=https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1
QWEN_MODEL=@cf/qwen/qwen3.8-27b
EMBEDDING_MODEL=@cf/qwen/qwen3-embedding-0.6b
MAINTENANCE_TOKEN=PASTE_YOUR_MAINTENANCE_SECRET
RATE_LIMIT_SALT=PASTE_A_DIFFERENT_RANDOM_SECRET
FORECAST_MODE=estimate
```

Replace every placeholder locally. .env.local is ignored by Git. Never upload the completed file or paste its contents into a PR. Restart the local server after changes.

## Verify the configuration

In /workspace, sign in as an approved account, expand **Connection checks**, and select **Run connection checks**. Testing AI is opt-in: the checkbox sends two fixed non-personal requests and consumes provider allowance.

Or run locally:

```bash
npm run check:setup
npm run check:setup -- --providers
npm run check:setup -- --providers --json
```

Reports contain statuses and constant repair instructions, not credentials or source documents. Configuration presence does not prove valid keys: run the connection test and then an actual upload/retrieval check.

## GitHub Actions maintenance

Open this GitHub repository → **Settings → Secrets and variables → Actions**.

| Location | Name | Value |
| --- | --- | --- |
| Variables | URBANFLOW_URL | Your production HTTPS origin, without /workspace or /api/maintenance. |
| Secrets | MAINTENANCE_TOKEN | Exactly the existing production maintenance token. |
| Variables | URBANFLOW_MAINTENANCE_ENABLED | true, after testing the endpoint. |

A Vercel secret is not automatically available to GitHub Actions. If the original maintenance token was not saved, generate a replacement, update it in **both** Vercel and GitHub, and redeploy before enabling the workflow.

Open **Actions → Private data maintenance → Run workflow**. Confirm success and monitor subsequent hourly runs. The job is skipped unless the enable variable equals true.

## Provider notes

Cloudflare's free allowance is bounded and shared across models; it is not unlimited hosting. For Cloudflare Qwen3.8, the adapter sets `chat_template_kwargs.enable_thinking=false` and allows 1,536 output tokens for concise evidence answers. Generation has a 60-second timeout, inside the chat function's 180-second budget. Source fallback messages distinguish provider timeouts, quota/access errors and invalid citations. A key being configured does not guarantee that every provider request will succeed.

The database expects 1,024-dimensional embeddings. The selected Qwen3 embedding model matches that shape; the application validates every vector. If changing the embedding model, re-index documents before expecting their vectors to match new queries. The document list displays the model used for each upload.

- [Cloudflare token and Account ID](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)
- [Cloudflare compatible API](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [Qwen3.8 chat model](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)
- [Qwen embedding model](https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
