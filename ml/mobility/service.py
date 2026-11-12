"""Authenticated inference service. Run outside Vercel on a persistent Python host.

Never deserialize untrusted checkpoints. MODEL_BUNDLE is a locally managed training export.
The endpoint honestly labels historical bundles, rather than pretending old data are live.
"""
import hmac,json,os,pathlib
from datetime import datetime,timezone,timedelta
from contextlib import asynccontextmanager
import numpy as np
import torch
from fastapi import FastAPI,HTTPException,Header
from .models import GCNGRU,GraphWaveNet,NodeGRU
from .validation import normalize_graph,validate_graph

state={}
@asynccontextmanager
async def lifespan(app):
    path=pathlib.Path(os.environ.get('MODEL_BUNDLE','artifacts/run'))
    if not os.environ.get('MODEL_SERVICE_TOKEN'):raise RuntimeError('MODEL_SERVICE_TOKEN is required')
    report=json.loads((path/'report.json').read_text());bundle=np.load(path/'inputs.npz',allow_pickle=False)
    architecture=report['selected']['architecture'];key=report['selected']['graph'];n=len(bundle['zone_ids'])
    if key:validate_graph(bundle[key],bundle['zone_ids'])
    if architecture=='GCNGRU':model=GCNGRU(n,report['context'],normalize_graph(bundle[key]),horizon=report['horizon'])
    elif architecture=='GraphWaveNet':
        a=bundle[key];d=a.sum(1,keepdims=True);w=np.divide(a,d,out=np.zeros_like(a),where=d>0)
        model=GraphWaveNet(n,report['context'],[w],horizon=report['horizon'])
    elif architecture=='NodeGRU':model=NodeGRU(n,report['context'],horizon=report['horizon'])
    else:raise RuntimeError('Unsupported model architecture')
    model.load_state_dict(torch.load(path/'model.pt',map_location='cpu',weights_only=True));model.eval()
    state.update(report=report,bundle=bundle,model=model)
    yield
    state.clear()

app=FastAPI(title='UrbanFlow model inference',lifespan=lifespan)
def authorize(authorization):
    expected='Bearer '+os.environ.get('MODEL_SERVICE_TOKEN','')
    if not os.environ.get('MODEL_SERVICE_TOKEN') or not authorization or not hmac.compare_digest(authorization,expected):
        raise HTTPException(401,'Unauthorized')

@app.get('/health')
def health():return {'status':'ok','model_loaded':bool(state)}

@app.get('/forecast')
def forecast(authorization:str|None=Header(default=None)):
    authorize(authorization)
    if not state:raise HTTPException(503,'Model not loaded')
    r,b,m=state['report'],state['bundle'],state['model']
    with torch.no_grad():
        pred=m(torch.from_numpy(b['window'][None].astype('float32')),torch.from_numpy(b['context'][None].astype('float32'))).numpy()[0]
        counts=np.maximum(np.expm1(pred*b['sd']+b['mu']),0)
    if not np.isfinite(counts).all():raise HTTPException(503,'Invalid model output')
    observed=datetime.fromisoformat(r['last_observed_at']);now=datetime.now(timezone.utc)
    # Naive local timestamps are ambiguous and MUST remain historical.
    live=observed.tzinfo is not None and timedelta(0)<=now-observed.astimezone(timezone.utc)<=timedelta(minutes=90)
    return {'mode':'live' if live else 'historical','model':r['selected']['model'],
        'issuedAt':observed.isoformat() if observed.tzinfo else observed.replace(tzinfo=__import__('zoneinfo').ZoneInfo('America/New_York')).isoformat(),
        'historySource':r['history_source'],'rows':[{'zoneId':int(z),'horizon':h+1,'value':float(counts[h,j])} for h in range(r['horizon']) for j,z in enumerate(b['zone_ids'])],
        'message':'Forecast from observed demand ending at issuedAt. Old or timezone-ambiguous bundles are historical only.'}
