# RAG storage, retrieval and personal use

Reviewed against production commit `2819ab03ddf13b743eede8383a1a53b0ec75b29d` on November 25, 2026. This is an implementation plan; the services below have not been provisioned and the database design has not been applied.

## What is running now

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Forecasting | ONNX Residual Graph (OD + correlation), 168 input hours, five direct horizons | Production returned 1,315 rows: 263 zones × 1/3/6/12/24 hours. Its origin is February 7, 2025 at 23:00 EST: historical replay, not current demand. |
| Forecast evidence | Forecast API is separate from the chat corpus | Chat does not have the actual zone forecast rows. Exact demand questions need a structured call to `getForecast()`, not guessed numbers. |
| Knowledge | Public `data/knowledge.json`, archived research status, official feed status and alerts | Bundled knowledge survives deployments; feed responses have a process-local 60-second cache. There is no persistent incident archive. |
| Retrieval | BM25-style lexical ranking in `lib/rag.ts`, maximum five source documents | No embedding API, vector database or semantic vector index. This is usable RAG for the current small corpus. |
| Generation | Optional Qwen chat-completions request | Production health reported `qwenConfigured: false`; the verified chat displayed cited excerpts. |
| Conversations | Question and last answer in React state | No saved history, cross-device memory, upload API or reusable personal knowledge store. Switching sections can reset chat. |
| Identity | No application login, sessions or document ownership checks | Vercel deployment protection is a separate hosting setting. A private URL alone is not authorization; verify protection on every alias. |
| Limits | Atomic Upstash limiter for paid Qwen calls, 15/minute/IP | Production health reported `sharedRateLimitConfigured: false`; paid generation fails closed if a key is enabled without the limiter. Retrieval itself is not limited by that check. |

The deployment is built successfully, and browser checks confirmed forecast selections, a routed JFK–Midtown fare and cited retrieval. This does not establish current forecasting accuracy or verify an unconfigured Qwen account. Citizen is not configured. Current MTA/DOT availability is independent of model availability.

## Recommended storage layout

Use **Neon Postgres + pgvector**, **private Vercel Blob**, **Upstash Redis**, and an application authentication provider. Install integrations from the project's Vercel Marketplace/Storage settings, choose a region close to the Vercel functions, and connect separate production and preview resources. Review plan costs before creating resources.

| Data | Store | Fields and rules |
| --- | --- | --- |
| Original PDFs/text and approved source snapshots | Private Blob | Opaque object key, owner, hash, content type, size. Authenticate and authorize before returning bytes. A Blob token stays on the server. |
| Documents | Postgres `documents` | ID, owner user ID, visibility (`private` or curated public), title, source URL, checksum, source version, fetched time, expiry, ingestion state. |
| Chunks | Postgres `chunks` | Document ID, owner/visibility, ordinal, source offsets, text, content hash, embedding model/version/dimension, vector, expiry. Enforce ownership consistency with the parent document. |
| Ingestion jobs | Postgres `ingestion_jobs` | Owner, document version, status, attempts and sanitized errors. Jobs must be idempotent and limited by upload size and quota. |
| Chat sessions/messages, only if the user opts in | Postgres `conversations`/`messages` | Owner, session ID, role, text, source IDs/versions and timestamps. Default to no persistence. Provide delete/export and a documented retention period. |
| Public feed history | Postgres `incident_versions` | Source record ID, source version/hash, active interval, fetched time, normalized text and geometry. Mark expired records so history cannot masquerade as an active alert. |
| Forecast results | Postgres `forecast_runs`/`forecast_rows`, if needed | Model/input version, observation cutoff, mode, zone, horizon and target hour. Use structured SQL/API retrieval for counts rather than embedding numerical rows. |
| Rate limits and short-lived results | Redis | Per-account limits plus IP abuse protection, TTL and quotas. Cache keys include owner/access scope, query, corpus version and model version. Redis is not the durable source of truth. |

Do not use a Vercel function's local filesystem or process memory for durable documents/history. Do not put private files, chats, embeddings, personal location histories, credentials or raw user uploads in this public GitHub repository.

## Ingest once, retrieve again

1. Authenticate the user on the server. For personal use, allow only your verified identity. For multiple users, assign ownership from the session, never a submitted `userId`.
2. Accept approved file types under size/quota limits. Validate the actual file, reject active content, and parse in a bounded background job. Use source allowlists for URL ingestion; block private-network destinations and unsafe redirects.
3. Write the original into private Blob. Hash normalized text; reuse unchanged documents/chunks instead of paying to embed them on every question.
4. Split text at headings/paragraphs. Start with roughly 400–800 tokens and 50–100 tokens of overlap, then tune against actual questions. Preserve title, source URL, page/offset, timestamps, ownership and expiry on every chunk.
5. Embed approved chunks server-side. A concrete option is Alibaba `text-embedding-v4` at **1,024 dimensions**, subject to the chosen account/region's availability and data handling terms. Use a distinct embedding configuration; `QWEN_MODEL=qwen-plus` is a chat setting and does not create embeddings. Alternatively run a vetted local embedding model when text must not leave your infrastructure.
6. Persist vectors with the exact model/version/dimension and text hash. Use the same embedding model and preprocessing for the query. Changing model or dimension requires re-embedding into a separate versioned index; equal dimensions do not make different models compatible.
7. On a question: verify the session → embed the query → retrieve only authorized, unexpired chunks → combine vector and keyword results → rerank/deduplicate → send a small evidence set to Qwen → return citations. Apply owner/visibility filters inside the database query **before** ranking and limiting. Never fetch another user's text and filter it after sending it to the model.
8. Answers cite source IDs/versions, URLs and timestamps. Store a generated answer only in the owner's opt-in conversation. Do not automatically ingest generated answers as verified source material. Follow-up conversation context is separate from the source corpus.
9. On source changes, ingest a new version and invalidate affected caches/vectors. On deletion, remove originals, chunks, vectors, optional messages and cached results; document backup retention separately.

For a small collection start with exact vector scans and Postgres full-text search. Add an HNSW cosine index only after measuring recall/latency. Filters and approximate search need evaluation together, especially for small per-user collections. Select top-k and similarity thresholds using an evaluation set; no universal cutoff proves an answer is supported.

## Identity and isolation

- **Only you:** keep hosting protection enabled for all relevant deployment aliases and implement an allowlisted application login before enabling personal files/history. If later serving public visitors, keep public mobility evidence and private documents in distinct scopes.
- **Multiple accounts:** implement server-verified sessions on upload, search, chat, history, export and deletion routes. Use Postgres row-level security on every user-owned table with both `USING` and `WITH CHECK`. Use a non-owner application role without `BYPASSRLS`; table owners/superusers can bypass ordinary policies. Set any per-request database identity transaction-locally to prevent pooled connections reusing another user's context. Test policy behavior with the actual deployed database role.
- **No global personal cache:** key private retrieval/answer caches by the verified owner and corpus version. Public and private content must not share cache entries. Send `Cache-Control: private, no-store` for chat, history and private downloads.
- **Source ownership:** verify access again when a user follows a private citation or downloads a document. A private Blob URL is not an owner authorization policy.

The existing IP limiter stores a truncated SHA-256 identifier with a short TTL. This is pseudonymous rate-limit data, not a guarantee of anonymity. Add account-level quotas after login and enforce limits on retrieval/embedding/upload as well as generation.

## Current safeguards and remaining gaps

Present: server-side provider credentials, bounded questions/upstream reads, HTTPS-configured provider endpoints, cross-origin rejection when an Origin header is present, React-escaped text rendering, explicit prompt instruction to treat retrieved content as untrusted data, and fail-closed limits on paid generation. This change also marks chat responses/errors `private, no-store` and explains question handling in the UI.

These controls are not authentication or a complete prompt-injection defense. Missing Origin headers are accepted. The app currently has no private-document authorization, persistent deletion flow or personal-data retention controls because it does not implement those features. Source text is untrusted even when it has a high similarity score. Do not let retrieved instructions invoke tools or disclose secrets. Validate citation IDs against the retrieved evidence and keep provider/tool permissions minimal.

Embeddings are sensitive derivatives of source text; they are not encryption. Apply the same ownership, access, deletion and backup rules to text and vectors. Use TLS, provider-managed encryption at rest, least-privilege database credentials and separate environments. Avoid logging question bodies, raw source excerpts, access tokens or precise trip histories. Review Qwen/embedding provider region, retention and training settings before sending personal data; an app-level “not saved” notice does not guarantee a third party keeps no records.

## Order of implementation

1. Review/merge the forecast UI and evidence corrections. Verify the Vercel deployment for that exact commit.
2. Choose personal-only versus multiple accounts and implement/test login and owner checks.
3. Connect Postgres, private Blob and Redis. Add server-only settings and migrations to the preview environment first. Required secrets/settings depend on provider: database URL, Blob credentials or OIDC setup, auth secret/callback URL, embedding endpoint/key/model/dimensions, plus the existing Qwen and Upstash variables. Keep credentials out of `NEXT_PUBLIC_*`.
4. Implement document/chunk schema, private ingestion, reusable embeddings and scoped hybrid retrieval. Seed only approved public documents; no private material in build output.
5. Add optional conversation memory with retention, deletion and export; add a structured forecast lookup for zone/horizon questions. Current dynamic forecast counts should come from `getForecast()`, with mode and target date attached.
6. Verify cold starts/redeploy persistence, changed-document reindexing, expired-alert exclusion, no-evidence abstention, citation validity, provider failure, rate limits and deletion. Create users A/B and prove that B cannot search, cite, export, read or delete A's content, including through caches. Then verify production with its actual database role and credentials.

## References

- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)
- [Vercel private Blob access](https://vercel.com/docs/vercel-blob/private-storage)
- [Neon pgvector](https://neon.com/docs/extensions/pgvector)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Alibaba embedding API](https://www.alibabacloud.com/help/en/model-studio/text-embedding-synchronous-api)
