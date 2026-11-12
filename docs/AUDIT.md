# Research and application audit

The repository initially contained a 39.7 MB executed Colab notebook, a short README and a project overview document. It included PyTorch GCN-GRU / Graph WaveNet models, a local Qwen prototype, and a Gradio dashboard. It did not include a deployable web app, trained checkpoints, graph matrices, demand parquet files or saved result CSV files.

## Findings and corrections

| Finding | Effect | Change |
|---|---|---|
| Gap imputation and gap detection used the full-year hour-of-week median | Future observations influenced training values and evaluation masks | Notebook profiles now fit training only; suspicious observed zeros remain unchanged and scored |
| All unusual zero counts were treated as data gaps | Legitimate low demand could be removed from evaluation | No automatic replacement/exclusion of observed zero counts |
| Spring DST was imputed from both adjacent hours | One future hour entered a past input | Past-week proxy in legacy notebook; new pipeline masks both ambiguous/nonexistent local labels and fills inputs causally |
| Original fall-back counts were halved and rounded | Approximate exposure normalization, not recovery of the two true hours | Documented limitation; both DST labels masked in the new pipeline |
| Weather interpolated from both directions | Future weather could fill historical missing inputs | Forward-only fill; original observed weather still must be available at forecast issue time |
| Graph archive omitted zone ordering | Matching matrix shape could silently associate weights with the wrong zones | Both exporters now write `zone_ids`; new training refuses ordering mismatches |
| Evaluation accepted nonfinite forecasts | Invalid model outputs could yield meaningless results | Shape/finiteness checks, explicit masks, undefined WAPE reported as null/NaN for zero-total targets |
| Reloaded result tables contained seed and feature ablations | Main model selection could be contaminated by alternate experiments | Bracket-tagged variants excluded from main selection |
| Diebold–Mariano variance could be zero or sample too short | Division by zero or misleading significance | Guarded sample count, lag length and degenerate variance |
| Current-day notebook forecasts seeded from a typical historical pattern | Not a forecast conditioned on real current observations | New service identifies historical inputs and never silently fabricates live demand |
| UI/LLM could confuse graph statistics with transport certainty | Unrealistic accuracy, prices and closure claims | Snapshot labels, cited evidence, source timestamps and explicit missing-data states |

The legacy notebook's code outputs were cleared after corrections. Its original saved results were extracted first into `data/research.json` with a SHA-256 source hash. Those numbers are archived observations, not verified accuracy after these corrections. Full-year EDA remains descriptive; do not reuse its full-year summaries as predictive features.

## What the archived results actually say

November–December 2025, all zones:

| Model | MAE +1h | MAE +3h | MAE +6h |
|---|---:|---:|---:|
| Spatial LightGBM | 3.528 | 4.368 | 4.716 |
| Correlation GCN-GRU | 4.086 | 4.730 | 5.031 |
| No-graph GRU | 4.523 | 5.088 | 5.570 |

The selected GNN improved on GRU but did **not** beat spatial LightGBM. No new claim of GNN superiority is justified. Saved contiguity/distance/OD/correlation graphs report 672/1254/2308/2413 edges, with 0/0/2/3 isolated nodes. Without the original graph arrays, these values cannot be independently recomputed. Self-loop normalization supports isolated nodes; isolation is diagnosed, not silently hidden.

## New Python path

`mobility.prepare` streams monthly downloads to disk, aggregates official TLC records, preserves true zero demand, masks local DST labels, and fits OD/correlation graphs on training records only. It requires the optional geospatial requirements. Downloaded data are not committed.

`mobility.train` trains a no-graph GRU, GCN-GRU across available graph definitions, and Graph WaveNet. It uses training-only log scaling, causal missing-input filling, observed masked targets, disjoint chronological target windows, counts-space loss, validation-based checkpoint/model selection, and identical test masks for simple baselines. It exports hashes, zone order, checkpoint, graphs, scaling, last observed window and context. Architecture implementations were extracted from the notebook and tested for forward/backward behavior; they are not claims of exact reproduction of a paper implementation. Run multiple seeds and retain LightGBM comparisons in the research notebook before making scientific conclusions.

`mobility.service` loads only a trusted local checkpoint (`weights_only=True`), authenticates requests, and labels old/ambiguous input data historical. Bundles need updating through a trusted ingestion process to produce ongoing live forecasts. TLC monthly data are delayed, not a real-time taxi sensor feed.

## Live data and prices

- NYC DOT `i6b5-j7bu`: planned construction by block. Queried by New York local work dates, maximum 300 active permits. A permit is not confirmed full closure. Locations are representative segment points. Dates are local labels, not invented UTC instants.
- MTA `camsys/all-alerts`: only subway-route alerts currently active. A missing end time remains unspecified.
- MTA subway GTFS trip-update feeds: per-station next-hour predictions; reject timestamps older than five minutes, canceled trips and skipped/no-data stops. North/south are GTFS directions, not destination claims. Refresh every 30 seconds. A subset of feeds may fail independently.
- MTA station selectors use official NY State open-data station stop IDs, originally downloaded from the MTA entrances dataset `i9wp-a4ja`. The snapshot can be regenerated if station identifiers change.
- Citizen: unused unless an authorized adapter is supplied. No scraping, undocumented API claim, or invented Citizen data.
- Disruption exposure: distance-decay **heuristic**, not learned future closures, calibrated probabilities, actual road routing, demand uplift, or a GNN output. Unlocated subway alerts are not given fabricated coordinates.
- Taxi estimator: source-checked TLC standard yellow taxi meter rules. It separates distance above 12 mph from slow/stopped time, adds applicable explicit surcharges, and excludes airport/out-of-city special rates, other tolls and tips. No rideshare surge quote is inferred. Review rate changes against the official source.

## RAG and operational boundaries

Small-corpus BM25-style retrieval is deterministic and transparent. Retrieved source excerpts and current alert/status documents are passed to hosted Qwen via the OpenAI-compatible API; generation is constrained to evidence and citations. This is retrieval augmented generation; embeddings/vector storage are unnecessary for this corpus size. Larger document collections can add an embedding index later.

The public chatbot has a capped input/context/output and refuses paid production requests without an atomic shared Redis rate limiter. Server-side provider keys never enter the browser. Upstream URLs are server configuration, never user-supplied. Responses and timeouts are bounded; upstream failures produce clear source excerpts instead of fabricated generated answers. No chat transcripts are persisted. Live credentials and real Qwen generation still need integration verification in the user's hosting account.
