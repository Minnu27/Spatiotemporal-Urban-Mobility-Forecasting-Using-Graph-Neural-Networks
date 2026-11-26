# Storage, retrieval and personal use

This describes the code in this branch and replaces the earlier infrastructure proposal. Configure Supabase and provider credentials using [SETUP.md](SETUP.md). Code verification does not establish that a database, provider account or scheduler is activated in production.

| Earlier gap | Implemented behavior | Activation / remaining limit |
| --- | --- | --- |
| Historical replay as the default | Current-date ONNX estimate with a 168-hour estimated pickup window, recent Open-Meteo weather and recovered training scalers. Replay requires `FORECAST_MODE=replay`. | No actual current pickup feed. The bundled reference is one real 2025 week; replace it using the full-data profile script. Current accuracy needs prospective validation. |
| Forecasts absent from chat evidence | Structured zone/horizon lookup through `getForecast()`, including value, mode, source, origin and target hour. | Select zone/horizon in the private workspace. Counts are never inferred from embeddings. |
| No incident archive | Version-hashed incident snapshots in Postgres; separate archive API, optional historical search in chat and 30-day retention. | Service key and scheduled maintenance required. Archive is sampled on refresh, not a complete ledger. Archived incidents never replace active evidence. |
| No semantic retrieval | Persistent 1,024-dimensional embeddings plus full-text retrieval, fused after owner/expiry/model filtering. | Provider key and SQL migration required. Exact cosine scans suit this limited collection; evaluate quality with actual questions. |
| No generation account | Qwen integration, bounded evidence, citation-index validation and source-excerpt fallback. | Qwen account/key required. Valid indices do not prove every generated claim is true. |
| No personal knowledge or history | Private text/Markdown uploads, content-hash reuse, stored chunks/vectors, opt-in conversations with reopen/export/delete. | Documents: 16,000 characters / 100 per account; history: 200 messages/conversation. PDFs and URL ingestion are unsupported. |
| No identity / ownership | Supabase verified sessions and owner-approved membership. API checks plus RLS and private bucket paths. | Create/approve accounts, disable public signup and test two accounts in deployment. Public mobility pages remain public. |
| Retrieval not limited | Atomic account quotas for upload, chat/retrieval and reads. Anonymous retrieval/generation also require shared limits. | Supabase service key + salt, or Upstash for public chat. Missing/unavailable limits reject requests before provider calls. Direct Supabase APIs follow RLS; configure their abuse controls separately. |

## Ingest once and retrieve again

The server verifies the session and enabled membership. Ownership comes from `auth.getUser()`, never a submitted user ID. Text is normalized, hashed and divided into at most 1,800-character chunks with 180-character overlap and source offsets. Unchanged content with the same embedding model reuses vectors. Changed content creates another document; delete the previous version when it should stop appearing in retrieval.

Normalized originals live in private Supabase Storage. Postgres stores metadata, chunk offsets, model identifiers and `vector(1024)` embeddings. A transaction commits all chunks and marks the document ready. Failed ingestion hides it and attempts cleanup; owner deletion or maintenance can retry. Bounded uploads execute synchronously within a 60-second budget, without a background job queue.

Search uses the user's session, never the administrative key. SQL filters ownership, membership, readiness, expiry and embedding model before semantic/keyword ranking. Candidates combine through reciprocal rank fusion. Query embeddings are computed per question; document vectors persist. There is no global personal-result cache. Changing a model requires re-embedding; equal dimensionality does not make different models compatible.

Private downloads verify ownership again. All private/chat responses and errors are `private, no-store`. React escapes text; no source HTML executes. Mutations require a matching Origin. No arbitrary URL fetching or model-triggered tools are exposed. Question/history/source text is untrusted. Prompt instructions and citation checks reduce mistakes; they do not prove correctness or solve prompt injection generally.

## Retention and deletion

- Documents expire 90 days after creation; conversations 30 days after creation. Exchanges do not extend an existing conversation's expiry.
- Expired chunks immediately disappear from retrieval; expired conversations cannot reopen or supply context. Physical originals/rows need scheduled cleanup. Direct Storage access follows owner authorization until cleanup completes.
- Document deletion first hides it from search, removes its object, then deletes metadata/chunks/vectors. Storage failure leaves a hidden `deleting` record for retry.
- Conversation deletion cascades messages. Saved answers can still contain excerpts of subsequently deleted documents; delete those conversations too when removing all copies.
- Maintenance also removes orphan Storage objects and abandoned indexing records after one hour, then removes expired/failed documents in batches of 50, deletes expired chat/archive data, and refreshes official feeds. Repeat for a backlog and monitor scheduled runs.
- This app intentionally avoids logging document/question bodies. Hosting logs, database backups and external providers have separate retention; application deletion does not erase those copies.

## Personal use and security boundaries

For personal use, approve only your account. Each additional approved account owns separate data. Supabase administrators/service credentials can bypass RLS. This is access control, not end-to-end encryption. Embeddings are sensitive derivatives and receive the same owner/deletion controls as text.

Use TLS, provider-managed encryption at rest and separate Supabase projects for preview/production. Keep the service key server-only. The Supabase URL and publishable key are public configuration and require the supplied RLS/bucket policies. Review provider region, backup retention and data-processing settings before entering sensitive information. Upload consent covers external embeddings; Qwen receives your question, matching excerpts and recent saved context.

Vercel deployment protection can additionally restrict the whole website but is separate from application authorization. Citizen is optional; without an authorized adapter it is omitted from the enabled feed count. Provider outages remain unavailable rather than fabricated working feeds.

## Included verification

`npm test` runs the migration in PostgreSQL/pgvector through PGlite as authenticated non-owner roles. It checks cross-account tables, search, storage policies, forged ownership, conversations, membership and concurrent limits. Other tests cover chunk offsets, vector dimensions/order, citation indices, absent configuration, Origin enforcement and weather preprocessing. Run the deployed acceptance steps in [SETUP.md](SETUP.md) too; local tests cannot validate cloud credentials and settings.
