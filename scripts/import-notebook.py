"""Import documented saved results, never label them as independently reproduced."""
import hashlib, json, pathlib, re, argparse
root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(); parser.add_argument('--notebook',type=pathlib.Path,required=True)
path=parser.parse_args().notebook; notebook=json.loads(path.read_text())
text='\n'.join(''.join(o.get('text',[])) or ''.join(o.get('data',{}).get('text/plain',[])) for o in notebook['cells'][40].get('outputs',[]))
section=text.split('1. TEST RESULTS — ALL ZONES')[1].split('1. TEST RESULTS — ACTIVE ZONES')[0]
rows=[]
for line in section.splitlines():
 m=re.match(r'^(Best baseline|LightGBM \+ spatial|LightGBM|GRU \(no graph\)|GCN-GRU random graph|Best GNN)\s+((?:\d+\.\d+\s*){7})$',line.strip())
 if m:
  nums=list(map(float,m[2].split()))
  names={'Best baseline':'Weekly moving average (4 weeks)','Best GNN':'GCN-GRU (correlation)','LightGBM + spatial':'LightGBM + spatial lags'}
  for i,h in enumerate([1,3,6]):rows.append({'model':names.get(m[1],m[1]),'horizon':h,'mae':nums[i],'rmse':nums[3+i]})
if len(rows)!=18:raise ValueError('Notebook output format changed; inspect instead of guessing')
report={'status':'notebook_snapshot','independentlyReproduced':False,'source':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'cell':40,'period':'November–December 2025','rows':rows,
 'graphs':[{'name':'Contiguity','edges':672,'meanDegree':5.1,'isolated':0},{'name':'Distance (kNN)','edges':1254,'meanDegree':9.5,'isolated':0},{'name':'OD flow','edges':2308,'meanDegree':17.6,'isolated':2},{'name':'Correlation','edges':2413,'meanDegree':18.3,'isolated':3}],
 'limitations':['Saved notebook outputs, not an independent rerun.','Full-year gap imputation leaks future information; rerun after corrections.','Trained checkpoints, demand matrices and graph arrays are absent from this repository.','Live notebook forecasts use typical demand as a proxy for recent observations and recurse beyond the trained horizon.','Spatial LightGBM outperformed the GNNs in the saved comparison.']}
(root/'data'/'research.json').write_text(json.dumps(report,indent=2)+'\n')
