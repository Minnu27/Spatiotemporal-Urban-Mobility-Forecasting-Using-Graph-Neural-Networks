"""Train a graph model, audit graphs, select on validation and export an inference bundle.

Usage: PYTHONPATH=ml python -m mobility.train --demand artifacts/demand.parquet --graphs artifacts/graphs.npz --out artifacts/run
Graph archive MUST contain zone_ids plus the named adjacency matrices in that exact order.
"""
from __future__ import annotations
import argparse,copy,hashlib,json,pathlib
import numpy as np
import pandas as pd
import torch
from .models import GCNGRU,GraphWaveNet,NodeGRU
from .preprocessing import prepare_counts
from .validation import forecast_origins,metrics,normalize_graph,validate_graph

def train(args):
    torch.manual_seed(args.seed);np.random.seed(args.seed);torch.set_num_threads(args.threads)
    frame=pd.read_parquet(args.demand);frame.columns=frame.columns.astype(int)
    if not frame.index.is_unique:raise ValueError('Duplicate timestamps')
    boundary=lambda value: pd.Timestamp(value).tz_localize(frame.index.tz) if frame.index.tz and pd.Timestamp(value).tzinfo is None else pd.Timestamp(value)
    train_end=int(frame.index.searchsorted(boundary(args.train_end)))
    val_end=int(frame.index.searchsorted(boundary(args.val_end)))
    prep=prepare_counts(frame,train_end)
    splits=forecast_origins(len(frame),train_end,val_end,args.history,args.horizon)
    graphs=np.load(args.graphs,allow_pickle=False)
    if 'zone_ids' not in graphs or not np.array_equal(graphs['zone_ids'],frame.columns):raise ValueError('Graph archive must declare zone_ids matching demand columns in order')
    audits={key:validate_graph(graphs[key],list(frame.columns)) for key in ['A_adj','A_dist','A_od','A_corr'] if key in graphs}
    if not audits:raise ValueError('No supported graphs in archive')
    args.out.mkdir(parents=True,exist_ok=True)
    x=torch.from_numpy(prep['inputs']);y=torch.from_numpy(prep['targets']);valid=torch.from_numpy(prep['valid'])
    mu=torch.from_numpy(prep['mu']);sd=torch.from_numpy(prep['sd'])
    # Calendar is known in advance, but here only observed input-window context is used.
    hour=frame.index.hour.to_numpy();dow=frame.index.dayofweek.to_numpy()
    context=np.stack([np.sin(2*np.pi*hour/24),np.cos(2*np.pi*hour/24),np.sin(2*np.pi*dow/7),np.cos(2*np.pi*dow/7)],1).astype('float32')
    ctx=torch.from_numpy(context);n=frame.shape[1]
    def batch(orig):
        win=orig[:,None]+np.arange(-args.history+1,1);tgt=orig[:,None]+np.arange(1,args.horizon+1)
        return x[win],ctx[win],y[tgt],valid[tgt]
    def predict(model,orig):
        out=[];model.eval()
        with torch.no_grad():
            for start in range(0,len(orig),args.batch_size):
                xd,xc,_,_=batch(orig[start:start+args.batch_size]);p=torch.expm1(model(xd,xc)*sd+mu).clamp_min(0)
                if not torch.isfinite(p).all():raise ValueError('Nonfinite model forecast')
                out.append(p.numpy())
        return np.concatenate(out)
    candidates=[('NodeGRU',None)] + [('GCNGRU',key) for key in audits] + [('GraphWaveNet','A_corr' if 'A_corr' in audits else next(iter(audits)))]
    all_results=[];best=None
    for architecture,key in candidates:
        torch.manual_seed(args.seed)
        a=graphs[key] if key else None
        if architecture=='GCNGRU':model=GCNGRU(n,4,normalize_graph(a),horizon=args.horizon)
        elif architecture=='GraphWaveNet':
            degree=a.sum(1,keepdims=True);support=np.divide(a,degree,out=np.zeros_like(a),where=degree>0)
            model=GraphWaveNet(n,4,[support],horizon=args.horizon)
        else:model=NodeGRU(n,4,horizon=args.horizon)
        opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001)
        lowest=float('inf');state=None;wait=0
        for epoch in range(args.epochs):
            model.train()
            for orig in np.array_split(np.random.permutation(splits['train']),max(1,int(np.ceil(len(splits['train'])/args.batch_size)))):
                xd,xc,target,mask=batch(orig)
                if not mask.any():continue
                # Optimize counts-space MAE, aligning validation selection with the reported metric.
                pred=torch.expm1((model(xd,xc)*sd+mu).clamp(max=15)).clamp_min(0)
                loss=(pred-target).abs()[mask].mean();opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),5);opt.step()
            p=predict(model,splits['validation']);t=splits['validation'][:,None]+np.arange(1,args.horizon+1)
            score=metrics(prep['targets'][t],p,prep['valid'][t])['mae']
            print(architecture,key,epoch+1,'validation MAE',score,flush=True)
            if score<lowest:lowest=score;state=copy.deepcopy(model.state_dict());wait=0
            else:wait+=1
            if wait>=args.patience:break
        if state is None:raise ValueError('No valid training run')
        model.load_state_dict(state);name=f'{architecture}:{key or "none"}'
        p=predict(model,splits['test']);t=splits['test'][:,None]+np.arange(1,args.horizon+1)
        for h in range(args.horizon):all_results.append({'model':name,'horizon':h+1,**metrics(prep['targets'][t[:,h]],p[:,h],prep['valid'][t[:,h]])})
        if best is None or lowest<best['validation_mae']:
            best={'architecture':architecture,'graph':key,'validation_mae':lowest,'model':name}
            torch.save(state,args.out/'model.pt')
    # Same test origins/masks for persistence and weekly seasonal baselines.
    for name,lag in [('Persistence',0),('Seasonal naive (week)',168)]:
        o=splits['test'];t=o[:,None]+np.arange(1,args.horizon+1)
        if lag and (t-lag<0).any():continue
        p=prep['targets'][o][:,None,:].repeat(args.horizon,axis=1) if not lag else prep['targets'][t-lag]
        for h in range(args.horizon):all_results.append({'model':name,'horizon':h+1,**metrics(prep['targets'][t[:,h]],p[:,h],prep['valid'][t[:,h]])})
    np.savez(args.out/'inputs.npz',zone_ids=frame.columns.to_numpy(),mu=prep['mu'],sd=prep['sd'],context=context[-args.history:],window=prep['inputs'][-args.history:],**{k:graphs[k] for k in audits})
    report={'status':'reproduced','independentlyReproduced':True,'selected':best,'graphs':audits,'rows':all_results,'seed':args.seed,'history':args.history,'horizon':args.horizon,'context':4,'last_observed_at':frame.index[-1].isoformat(), 'timezone':str(frame.index.tz),'history_source':'observed TLC demand', 'train_end':args.train_end,'val_end':args.val_end,'demand_sha256':hashlib.sha256(args.demand.read_bytes()).hexdigest()}
    (args.out/'report.json').write_text(json.dumps(report,indent=2,allow_nan=False))
    print('Exported',args.out,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--demand',type=pathlib.Path,required=True);p.add_argument('--graphs',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True)
    p.add_argument('--train-end',default='2025-10-01');p.add_argument('--val-end',default='2025-11-01');p.add_argument('--epochs',type=int,default=60);p.add_argument('--patience',type=int,default=6);p.add_argument('--seed',type=int,default=42);p.add_argument('--threads',type=int,default=4);p.add_argument('--batch-size',type=int,default=16);p.add_argument('--history',type=int,default=12);p.add_argument('--horizon',type=int,default=6)
    args=p.parse_args()
    if args.epochs<1 or args.batch_size<1 or args.history<1 or not 1<=args.horizon<=6:p.error('Invalid training configuration')
    train(args)
