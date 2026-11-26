"""Extract research configuration without executing training or inventing scores."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = next(ROOT.glob('*.ipynb'))
# Human-reviewed notebook source. New code or saved outputs require a review
# before descriptive graph/model labels can be republished with a new hash.
REVIEWED_NOTEBOOK_SHA256 = '65cfe93f2b491f2b7bcd3131eee5f71fc81dc66b67ae5762170fb0a751b62653'

def source(cell):
    return ''.join(cell.get('source', []))

def assignments(code):
    result = {}
    for node in ast.walk(ast.parse(code)):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    try:
                        result[target.id] = ast.literal_eval(node.value)
                    except (ValueError, TypeError):
                        if isinstance(node.value, ast.Call) and node.value.args:
                            try:
                                result[target.id] = ast.literal_eval(node.value.args[0])
                            except (ValueError, TypeError):
                                pass
    return result

def build_report():
    raw = NOTEBOOK.read_bytes()
    if hashlib.sha256(raw).hexdigest() != REVIEWED_NOTEBOOK_SHA256:
        raise SystemExit('Notebook changed. Review its configuration, descriptions and outputs, then update REVIEWED_NOTEBOOK_SHA256 before regenerating research.')
    notebook = json.loads(raw)
    cells = notebook['cells']
    setup = assignments(source(cells[36]))
    assert setup['EVAL_H'] == [1, 3, 6], 'Review changed notebook horizons before publishing.'
    features = []
    feature_code = ast.parse(source(cells[33]))
    weather = assignments(source(cells[33]))['wx_cols']
    for node in feature_code.body:
        if isinstance(node, ast.For) and isinstance(node.iter, ast.Name) and node.iter.id == 'wx_cols':
            features.extend(weather)
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and target.value.id == 'context' and isinstance(target.slice, ast.Constant):
                    features.append(target.slice.value)
    commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', NOTEBOOK.name], cwd=ROOT, text=True).strip()
    blob = hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()
    metadata = json.loads((ROOT / 'model/metadata.json').read_text())
    output_cells = sum(bool(cell.get('outputs')) for cell in cells if cell['cell_type'] == 'code')
    return {
        'status': 'awaiting_notebook_rerun' if output_cells == 0 else 'notebook_outputs_need_review',
        'independentlyReproduced': False,
        'notebook': {'path': NOTEBOOK.name, 'commit': commit, 'gitBlob': blob, 'sha256': hashlib.sha256(raw).hexdigest(),
                     'cellCount': len(cells), 'codeCells': sum(c['cell_type'] == 'code' for c in cells),
                     'cellsWithOutputs': output_cells, 'executedCodeCells': sum(c.get('execution_count') is not None for c in cells if c['cell_type'] == 'code'),
                     'configurationCellIndex': 36, 'featureCellIndex': 33, 'graphCellIndex': 34},
        'dataset': {'year': 2025, 'period': 'January–December 2025', 'expectedLocalClockHours': 8760,
                    'geographicZones': len(json.loads((ROOT / 'data/zones.json').read_text())),
                    'source': 'NYC TLC yellow taxi monthly parquet files', 'countsVerifiedInThisRun': False},
        'experiment': {'inputHours': setup['T_IN'], 'maximumHorizon': setup['H'], 'evaluationHorizons': setup['EVAL_H'],
                       'minimumHistoryHours': setup['MIN_HISTORY'],
                       'splits': [{'name': 'Training', 'period': 'January–September 2025', 'start': '2025-01-01', 'endExclusive': setup['TRAIN_END']},
                                  {'name': 'Validation', 'period': 'October 2025', 'start': setup['TRAIN_END'], 'endExclusive': setup['VAL_END']},
                                  {'name': 'Test', 'period': 'November–December 2025', 'start': setup['VAL_END'], 'endExclusive': '2026-01-01'}],
                       'contextFeatures': features, 'metrics': ['MAE', 'RMSE', 'WMAPE'], 'subsets': ['All valid zone-hours', 'Active zones (training mean ≥ 1 pickup/hour)', 'Flagged event cells'],
                       'selection': 'Lowest mean validation MAE across evaluated horizons; seed and feature ablations excluded from main selection.',
                       'seeds': [42, 1, 2], 'ablations': ['No weather', 'No holiday flags', 'No context features'],
                       'models': ['Persistence, daily/weekly seasonal and historical-average baselines', 'LightGBM', 'LightGBM with spatial lags', 'GRU without graph', 'GCN-GRU across four graphs and a random control', 'Graph WaveNet with fixed and adaptive supports']},
        'graphs': [{'name': 'Contiguity', 'construction': '50-foot buffered polygon intersections; isolated zones linked to three nearest neighbors.', 'fit': 'TLC zone geometry', 'cellIndex': 27},
                   {'name': 'Distance (kNN)', 'construction': 'Gaussian distance weights over eight nearest zones; symmetrized.', 'fit': 'TLC zone geometry', 'cellIndex': 34},
                   {'name': 'OD flow', 'construction': 'Log two-way trip flow; ten strongest positive links per zone; symmetrized.', 'fit': 'January–September training trips only', 'cellIndex': 34},
                   {'name': 'Correlation', 'construction': 'Positive residual log-demand correlation after removing hour-of-week means; ten strongest links; symmetrized.', 'fit': 'January–September training demand only', 'cellIndex': 34}],
        'results': {'rows': [], 'winner': None, 'message': 'The current notebook has no saved evaluation outputs or checked-in results CSV. A corrected rerun is required before publishing new scores or a model winner.'},
        'deployment': {'model': metadata['model'], 'inputHours': metadata['history_hours'], 'horizons': metadata['horizons'],
                       'zones': len(metadata['zones']), 'contextFeatures': len(metadata['context_columns']), 'metadataPath': 'model/metadata.json',
                       'onnxSha256': hashlib.sha256((ROOT / 'model/forecast.onnx').read_bytes()).hexdigest(),
                       'accuracyEstablished': False, 'message': 'This separate ONNX export uses 168 input hours and five direct horizons. The default current-date demand estimate has no observed current pickup feed; the notebook archive does not validate this export.'},
        'limitations': ['Notebook outputs were cleared after preprocessing corrections; no current measured model ranking is available.',
                        'Yearly dataset totals in notebook prose have not been recomputed from the underlying parquet files in this review.',
                        'The current notebook evaluates 1/3/6 hours; 12/24-hour accuracy is not established by it.',
                        'The notebook uses chronological splits, not random month splits.',
                        'Standalone graph arrays and current evaluation CSVs are not checked in; archived edge counts cannot substitute for a rerun.'],
        'archivePath': 'data/research-archive.json',
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = ROOT / 'data/research.json'
    content = json.dumps(build_report(), indent=2, ensure_ascii=False) + '\n'
    if args.check:
        if target.read_text() != content:
            raise SystemExit('Research snapshot is stale. Run python scripts/sync-research.py and review the diff.')
        print('Research snapshot matches the notebook and ONNX metadata.')
    else:
        target.write_text(content)
        print('Updated data/research.json from notebook configuration; no evaluation scores were fabricated.')
