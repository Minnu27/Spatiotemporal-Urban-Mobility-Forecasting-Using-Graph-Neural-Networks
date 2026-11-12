from __future__ import annotations
import numpy as np
from scipy.sparse.csgraph import connected_components

def validate_graph(adjacency, zone_ids, *, symmetric=True):
    a = np.asarray(adjacency, dtype=float)
    if a.shape != (len(zone_ids), len(zone_ids)) or len(set(zone_ids)) != len(zone_ids):
        raise ValueError('Graph shape/node order mismatch or duplicate zone IDs')
    if not np.isfinite(a).all() or (a < 0).any():
        raise ValueError('Graph weights must be finite and nonnegative')
    if not np.allclose(np.diag(a), 0):
        raise ValueError('Raw graph must have a zero diagonal; add self-loops only during normalization')
    if symmetric and not np.allclose(a, a.T, atol=1e-7):
        raise ValueError('Expected an undirected graph')
    degree = (a > 0).sum(1)
    return {'nodes':len(zone_ids), 'edges':int(np.triu(a > 0, 1).sum()) if symmetric else int((a > 0).sum()),
            'mean_degree':float(degree.mean()), 'isolated_zone_ids':[int(zone_ids[i]) for i in np.where(degree == 0)[0]],
            'components':int(connected_components(a, directed=not symmetric)[0]),
            'min_weight':float(a.min()),'max_weight':float(a.max())}

def normalize_graph(a):
    a = np.asarray(a, dtype=np.float32) + np.eye(len(a), dtype=np.float32)
    d = 1 / np.sqrt(a.sum(1))
    return a * d[:,None] * d[None,:]

def metrics(actual, predicted, valid=None):
    y,p = np.asarray(actual,dtype=float),np.asarray(predicted,dtype=float)
    if y.shape != p.shape or not np.isfinite(y).all() or not np.isfinite(p).all() or (y<0).any():
        raise ValueError('Expected matching finite prediction/target arrays with nonnegative targets')
    m = np.ones(y.shape,dtype=bool) if valid is None else np.asarray(valid,dtype=bool)
    if m.shape != y.shape or not m.any():raise ValueError('Empty or mismatched evaluation mask')
    y,p=y[m],np.maximum(p[m],0);error=p-y
    return {'mae':float(np.abs(error).mean()),'rmse':float(np.sqrt(np.square(error).mean())),
            'wape':float(np.abs(error).sum()/y.sum()) if y.sum()>0 else None,'cells':int(len(y))}

def forecast_origins(length, train_end, val_end, history=12, horizon=6):
    if not 0 < history < train_end < val_end < length or horizon < 1:raise ValueError('Invalid chronological split')
    origins=np.arange(history-1,length-horizon)
    splits={'train':origins[origins+horizon<train_end],
            'validation':origins[(origins+1>=train_end)&(origins+horizon<val_end)],
            'test':origins[origins+1>=val_end]}
    if any(len(o)==0 for o in splits.values()):raise ValueError('Not enough samples in each split')
    return splits
