"""Extract saved benchmark tables and configuration without executing notebook code."""
import argparse
import ast
import calendar
import csv
import hashlib
from html.parser import HTMLParser
import io
import json
import lzma
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'data/notebook-source.json'
HORIZONS = [1, 3, 6, 12, 24]

def source(cell):
    return ''.join(cell.get('source', []))

def assignments(code):
    result = {}
    for node in ast.walk(ast.parse(code)):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    try: result[target.id] = ast.literal_eval(node.value)
                    except (ValueError, TypeError): pass
    return result

class Table(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.section = None; self.rows = {'thead': [], 'tbody': []}; self.row = None; self.cell = None
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        if tag in self.rows: self.section = tag
        elif tag == 'tr' and self.section: self.row = []
        elif tag in ('th', 'td') and self.row is not None:
            attrs = dict(attrs); self.cell = [[], int(attrs.get('rowspan', 1)), int(attrs.get('colspan', 1))]
        elif tag == 'br' and self.cell is not None: self.cell[0].append(' ')
    def handle_data(self, data):
        if self.cell is not None: self.cell[0].append(data)
    def handle_endtag(self, tag):
        if tag in ('th', 'td') and self.cell is not None:
            text, rowspan, colspan = self.cell; self.row.append((' '.join(''.join(text).split()), rowspan, colspan)); self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows[self.section].append(self.row); self.row = None
        elif tag in self.rows: self.section = None
    def grid(self, section):
        grid = []
        for r, cells in enumerate(self.rows[section]):
            while len(grid) <= r: grid.append([])
            col = 0
            for text, rowspan, colspan in cells:
                while col < len(grid[r]) and grid[r][col] is not None: col += 1
                for rr in range(r, r + rowspan):
                    while len(grid) <= rr: grid.append([])
                    while len(grid[rr]) < col + colspan: grid[rr].append(None)
                    for cc in range(col, col + colspan): grid[rr][cc] = text
                col += colspan
        return grid

def table(cells, cell, output):
    html = ''.join(cells[cell]['outputs'][output]['data']['text/html'])
    assert '<table' in html and len(html) < 100000
    parsed = Table(html)
    return parsed.grid('thead'), parsed.grid('tbody')

def stream(cells, cell):
    return ''.join(''.join(o.get('text', [])) for o in cells[cell].get('outputs', []))

def number(text):
    value = float(text.replace(',', ''))
    assert math.isfinite(value) and value >= 0, f'Invalid metric {text}'
    return value

def digest(data): return hashlib.sha256(data).hexdigest()

def build_report(verify_archive=False):
    manifest = json.loads(MANIFEST.read_text())
    path = ROOT / manifest['notebookPath']; raw = path.read_bytes()
    assert digest(raw) == manifest['notebookSha256'], 'Readable notebook hash differs from manifest.'
    notebook = json.loads(raw); cells = notebook['cells']
    code = '\n\n'.join(source(cell) for cell in cells if cell['cell_type'] == 'code')
    assert digest(code.encode()) == manifest['codeSha256'], 'Notebook code changed after import.'
    if verify_archive:
        compressed = (ROOT / manifest['archivePath']).read_bytes()
        assert digest(compressed) == manifest['archiveSha256'], 'Original archive hash mismatch.'
        original = lzma.decompress(compressed)
        assert digest(original) == manifest['originalSha256'], 'Original notebook hash mismatch.'
        original_nb = json.loads(original)
        original_code = '\n\n'.join(source(c) for c in original_nb['cells'] if c['cell_type'] == 'code')
        assert original_code == code, 'Code was changed while compacting the notebook.'
    config = assignments(source(cells[36])); assert config['EVAL_H'] == HORIZONS and config['H'] == 24
    features = []
    feature_code = ast.parse(source(cells[33])); weather = assignments(source(cells[33]))['wx_cols']
    for node in feature_code.body:
        if isinstance(node, ast.For) and isinstance(node.iter, ast.Name) and node.iter.id == 'wx_cols': features.extend(weather)
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and target.value.id == 'context' and isinstance(target.slice, ast.Constant): features.append(target.slice.value)
    assert len(features) == 14
    _, month_rows = table(cells, 36, 1)
    splits = []
    for key, label in [('train', 'Training'), ('val', 'Validation'), ('test', 'Test')]:
        rows = [r for r in month_rows if r[2] == key]
        months = [int(r[1][-2:]) for r in rows]
        splits.append({'name': label, 'key': key, 'months': months, 'period': ', '.join(calendar.month_abbr[m] for m in months) + ' 2025', 'origins': sum(int(r[3]) for r in rows)})
    assert sorted(m for split in splits for m in split['months']) == list(range(1, 13))
    assert [len(split['months']) for split in splits] == [8, 2, 2]
    assert 'seed 42' in stream(cells, 18)
    metrics = []
    for subset, output in [('all', 23), ('active', 25), ('events', 27)]:
        headers, rows = table(cells, 44, output)
        for row in rows:
            model = row[0]
            for horizon in HORIZONS:
                values = {}
                for col in range(1, len(row)):
                    if headers[0][col] in ('MAE', 'RMSE', 'WMAPE') and int(headers[1][col]) == horizon: values[headers[0][col].lower()] = number(row[col])
                assert set(values) == {'mae', 'rmse', 'wmape'}
                metrics.append({'model': model, 'split': 'test', 'subset': subset, 'horizon': horizon, **values, 'cellIndex': 44, 'outputIndex': output})
    assert len(metrics) == 270 and len({(r['model'], r['subset'], r['horizon']) for r in metrics}) == 270
    paper_headers, paper_rows = table(cells, 47, 3)
    duplicates = 0; seen = set()
    for row in paper_rows:
        if row[0] in seen: duplicates += 1
        seen.add(row[0])
        for col in range(1, len(row)):
            match = re.fullmatch(r'(MAE|RMSE|WMAPE) \(h=(\d+)\)', paper_headers[0][col])
            assert match
            metric, horizon = match.group(1).lower(), int(match.group(2))
            reference = next(r for r in metrics if r['subset'] == 'all' and r['model'] == row[0] and r['horizon'] == horizon)
            assert abs(reference[metric] - number(row[col])) < 1e-9, 'Conflicting paper and benchmark tables.'
    _, graph_rows = table(cells, 34, 1)
    definitions = [
        ('Contiguity', '50-foot buffered polygon intersections; isolated zones connected to three nearest neighbors.', 'TLC zone geometry'),
        ('Distance (kNN)', 'Gaussian distance weights over eight nearest zones; symmetrized.', 'TLC zone geometry'),
        ('OD flow', 'Log two-way flow, ten strongest positive links per zone; symmetrized.', 'Assigned training months only'),
        ('Correlation', 'Positive residual log-demand correlation after removing training hour-of-week means; ten strongest links.', 'Assigned training months only')]
    graphs = []
    for name, construction, fit in definitions:
        row = next(row for row in graph_rows if row[0] == name)
        graphs.append({'name': name, 'construction': construction, 'fit': fit, 'edges': int(number(row[1])), 'meanDegree': number(row[2]), 'isolated': int(number(row[3])), 'meanEdgeMiles': number(row[4]), 'overlapWithContiguity': number(row[5]), 'cellIndex': 34, 'outputIndex': 1})
    summary = stream(cells, 47)
    selected = re.search(r'Best GNN \(selected on validation\): (.+)', summary).group(1).strip()
    baseline = re.search(r'Best baseline \(selected on validation\): (.+)', summary).group(1).strip()
    total = int(re.search(r'Data: ([\d,]+) cleaned pickups', summary).group(1).replace(',', ''))
    assert selected == 'Residual Graph (OD + correlation)'
    assert re.search(r'history_hours\s*=\s*MIN_HISTORY', source(cells[44]))
    validation = {}
    for cell_index, output in [(41, 1), (42, 3), (44, 29)]:
        headers, rows = table(cells, cell_index, output)
        for row in rows:
            if not row[1].startswith('Validation'): continue
            for col in range(2, len(row)):
                horizon = int(headers[0][col]); key = (row[0], horizon)
                value = number(row[col])
                if key in validation: assert validation[key] == value
                validation[key] = value
    validation_rows = [{'model': model, 'horizon': horizon, 'mae': value} for (model, horizon), value in sorted(validation.items())]
    _, borough_rows = table(cells, 45, 1); _, condition_rows = table(cells, 45, 5)
    borough = [{'borough':r[0], 'selected':number(r[1]), 'gru':number(r[2]), 'spatialLightgbm':number(r[3]), 'changeVsGruPercent':float(r[4])} for r in borough_rows]
    conditions = [{'condition':r[0], 'selected':number(r[1]), 'gru':number(r[2]), 'spatialLightgbm':number(r[3])} for r in condition_rows]
    metadata = json.loads((ROOT / 'model/metadata.json').read_text())
    commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', manifest['notebookPath']], cwd=ROOT, text=True).strip()
    return {
        'status':'saved_notebook_benchmark', 'independentlyReproduced':False,
        'notebook':{'path':manifest['notebookPath'],'commit':commit,'sha256':manifest['notebookSha256'],'originalSha256':manifest['originalSha256'],'archivePath':manifest['archivePath'],'archiveSha256':manifest['archiveSha256'],'cellCount':len(cells),'codeCells':sum(c['cell_type']=='code' for c in cells),'cellsWithOutputs':sum(bool(c.get('outputs')) for c in cells),'executedCodeCells':sum(c.get('execution_count') is not None for c in cells if c['cell_type']=='code'),'configurationCellIndex':36,'featureCellIndex':33,'graphCellIndex':34,'resultCellIndex':44,'summaryCellIndex':47},
        'dataset':{'year':2025,'period':'January–December 2025','expectedLocalClockHours':8760,'geographicZones':263,'reportedCleanedMatrixTotal':total,'activeZones':156,'source':'Original NYC TLC yellow taxi monthly parquet files','countsVerifiedInThisRun':False,'qualification':'Saved cleaned-matrix total includes the notebook’s gap/DST processing; not a fresh recount of raw trip records.'},
        'experiment':{'inputHours':config['T_IN'],'selectedModelInputHours':config['MIN_HISTORY'],'maximumHorizon':config['H'],'evaluationHorizons':HORIZONS,'minimumHistoryHours':config['MIN_HISTORY'],'splitMethod':'seeded_whole_month','splitSeed':42,'splits':splits,'contextFeatures':features,'metrics':['MAE','RMSE','WMAPE'],'subsets':['All valid zone-hours','Active zones (training mean ≥ 1 pickup/hour)','Flagged event cells'],'selection':'Notebook reports the GNN selected by lowest mean validation MAE across all five horizons, excluding random-control GCN and bracket-tagged variants. Test-set leaders are reported separately.','seeds':[42],'ablations':[],'robustnessMessage':'The supplied saved outputs do not contain a multi-seed robustness or context-ablation result table.','models':sorted({r['model'] for r in metrics}),'monthBoundaryRule':'All 168 history hours and 24 target hours remain within a single assigned calendar month.'},
        'graphs':graphs,
        'results':{'rows':metrics,'selectedGnn':selected,'selectedBaseline':baseline,'winnerByHorizon':[{'horizon':h,'model':min((r for r in metrics if r['subset']=='all' and r['horizon']==h),key=lambda r:r['mae'])['model']} for h in HORIZONS],'reportedPrecisionDecimals':3,'partialValidationRows':validation_rows,'paperDuplicateRowsRemoved':duplicates,'message':'Reported saved notebook results on held-out February and September 2025; not an independent rerun or current-demand accuracy measurement.'},
        'breakdowns':{'horizon':1,'borough':borough,'conditions':conditions,'improvedActiveZones':152,'activeZones':156,'medianActiveZoneChangeVsGruPercent':-7.2,'cellIndex':45},
        'deployment':{'model':metadata['model'],'inputHours':metadata['history_hours'],'horizons':metadata['horizons'],'zones':len(metadata['zones']),'contextFeatures':len(metadata['context_columns']),'metadataPath':'model/metadata.json','onnxSha256':digest((ROOT/'model/forecast.onnx').read_bytes()),'accuracyEstablished':False,'notebookReportsOnnxParity': 'ONNX parity verified on three held-out TLC forecast origins.' in stream(cells,50),'benchmarkWeightsCryptographicallyLinked':False,'message':'The selected notebook model and deployed export share the reported architecture, 168-hour input and five horizons. The uploaded notebook contains no weight-file hash linking its benchmark scores to the currently deployed ONNX bytes. Current-date estimates still lack observed current pickups.'},
        'limitations':['Saved output snapshot supplied by the project owner; no independent retraining or raw-data recount was performed.','Training months include dates later than the held-out months. This tests held-out-month generalization within 2025, not forward-only deployment performance.','The selected GNN is not the lowest-MAE test model at every horizon or subset; distance + OD is lower at 12/24 hours, and event/holiday errors need separate review.','The notebook imputes suspected zero-count gaps using training profiles and excludes gap/DST target cells; metrics reflect those masks.','All cell execution counters are cleared although outputs remain. Full-precision result CSVs, checkpoints and repeated-seed results are not attached.','The paper display repeats the seasonal residual row. Its duplicate values were cross-checked against the complete benchmark table.'],
        'archivePath':'data/research-archive.json'
    }

def csv_content(report):
    stream = io.StringIO(newline=''); fields=['model','split','subset','horizon','mae','rmse','wmape','cellIndex','outputIndex']
    writer=csv.DictWriter(stream,fieldnames=fields,lineterminator='\n');writer.writeheader();writer.writerows(report['results']['rows']);return stream.getvalue()

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    report=build_report(verify_archive=args.check)
    outputs={ROOT/'data/research.json':json.dumps(report,indent=2,ensure_ascii=False)+'\n',ROOT/'public/research/benchmark.csv':csv_content(report)}
    for path,content in outputs.items():
        if args.check:
            if not path.exists() or path.read_text()!=content:raise SystemExit('Research snapshot is stale. Run python scripts/sync-research.py and review the diff.')
        else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
    print('Verified original archive, notebook code, saved benchmark tables and research snapshot.' if args.check else 'Extracted 270 reported benchmark rows; no training or invented scores.')
