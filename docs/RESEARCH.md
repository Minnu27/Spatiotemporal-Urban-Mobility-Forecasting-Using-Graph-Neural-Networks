# New notebook benchmark and source provenance

The supplied `Spatiotemporal_Urban_Mobility_Forcasting_GNNs (1).ipynb` contains saved results at 1, 3, 6, 12 and 24 hours. Its 52 cells include 39 code cells and 37 cells with saved outputs. Execution counters are cleared; saved outputs remain. No independent retraining was performed.

## Original and readable copies

The repository's main notebook path now holds a readable copy with identical code, plaintext logs and 78 HTML result tables. Large embedded PNG/map/widget presentation data are externalized to a complete lossless archive:

`notebooks/original/Spatiotemporal_Urban_Mobility_Forcasting_GNNs.ipynb.xz`

The original SHA-256 is `f91d8494a1499a09737d8fdd45132d2fd133306ecefd806bd63c761943dc5f67`. Original, readable, archive and code hashes are in `data/notebook-source.json`. Decompress the complete original with Python's standard library:

```bash
python -c "import lzma,pathlib; pathlib.Path('full-notebook.ipynb').write_bytes(lzma.decompress(pathlib.Path('notebooks/original/Spatiotemporal_Urban_Mobility_Forcasting_GNNs.ipynb.xz').read_bytes()))"
```

The resulting file is byte-for-byte identical to the supplied notebook, including all figures and interactive outputs. Open it in Colab to view those outputs. The readable copy removes no code or reported result tables. Neither copy executes when opened by the extraction script.

## What this run reports

| Setting | Saved run |
| --- | --- |
| Data | All twelve 2025 NYC TLC yellow-taxi months; 8,760 hourly labels, 263 zones |
| Cleaned matrix total | 48,629,564 after notebook gap/DST processing; not a fresh count of raw records |
| Split seed | 42 |
| Training | Jan, Mar, Apr, Jun, Jul, Aug, Oct, Dec |
| Validation | May, Nov |
| Test | Feb, Sep |
| Windows | Base GRU/GCN: 12h; selected residual: 168h; full 168h history + 24h target span stays inside one month |
| Horizons | 1 / 3 / 6 / 12 / 24 hours |
| Features | 14 calendar/weather features |
| Evaluation | MAE, RMSE, WMAPE on all valid cells, active zones and event cells |

The notebook summary selects **Residual Graph (OD + correlation)** by mean validation MAE. Its all-zone test MAE is **3.301 / 3.466 / 3.518 / 3.593 / 3.590**. It is lower than spatial LightGBM and the no-graph GRU at each horizon. The **distance + OD residual** model has lower all-zone test MAE at 12 and 24 hours. The selected model is therefore not an across-the-board test winner.

For +1h, saved analysis reports 152 of 156 active zones improving over GRU, median change −7.2%. Staten Island is worse than GRU, and event/holiday errors are higher than spatial LightGBM. These breakdowns are labeled +1h and do not silently follow the main horizon selector. Use the event-subset control to inspect the other event horizons.

Graph output reports: contiguity 672 edges / 0 isolated; distance 1,254 / 0; OD 2,320 / 3; correlation 2,421 / 3. These are the new run's saved graph diagnostics. Earlier OD/correlation counts remain only in the old archive.

## Residual-model design

The selected model corrects a training hour-of-week seasonal baseline using recent anomalies, daily/weekly anchors, graph-neighbor mixing, zone/time/horizon embeddings, quantile-bucket weather embeddings and multihead attention. The notebook adapts residual post-processing and feature-embedding ideas discussed in [Uber’s DeepETA article](https://www.uber.com/us/en/blog/deepeta-how-uber-predicts-arrival-times/) to hourly pickup counts. It is not a reproduction of Uber’s ETA serving stack or a trained taxi-fare model.

## Extraction and checks

```bash
python scripts/sync-research.py
python scripts/sync-research.py --check
npm test
npm run typecheck
npm run build
```

Only Python's standard library is needed for extraction. The script parses saved HTML tables without executing notebook code or JavaScript. It extracts all 270 test rows, validates finite/nonnegative metrics and unique model/subset/horizon keys, and cross-checks overlapping values against the paper table. The paper display repeats the seasonal residual model; identical duplicate values are verified rather than counted as another model.

`data/research.json` contains configuration, reported metrics and provenance. `public/research/benchmark.csv` is the downloadable 270-row benchmark. Source cells/output indices accompany every metric row. Values are saved to three decimal places; WMAPE ratios are rendered as percentages in the website. Partial validation tables are identified as partial; the model selection is attributed to the notebook summary. A three-seed robustness or context-ablation result table is not present.

The check mode additionally decompresses the complete archive, verifies the supplied original hash, and checks that all code cells match the readable notebook. A changed notebook, archive or manifest requires review before publishing a new snapshot.

## Interpretation and deployment

This protocol measures generalization to held-out months within 2025. Training contains months later than the test months, so it does not establish forward-only or prospective performance. Suspected zero-count gaps are imputed with training profiles; gap/DST cells are excluded from scoring. The reported matrix total includes those preprocessing choices.

The notebook reports ONNX/PyTorch parity on three held-out forecast origins. Its selected architecture/history/horizons match the website's metadata, but the upload does not include a weight-file hash connecting these benchmark scores to the deployed ONNX bytes. This update does not replace trained weights, scalers or the one-week reference profile. Default forecasts remain clearly labeled current-date estimates with no current observed-pickup feed. Taxi-fare/weather calculations remain separate from demand-model accuracy.

Earlier pre-correction scores are preserved in `data/research-archive.json` and a collapsed section. They used different preprocessing and test months, so their numerical differences are not a controlled before/after improvement. The Research download keeps current and archived runs separate. No new API key or database migration is required.
