from __future__ import annotations
import numpy as np
import pandas as pd

def prepare_counts(frame: pd.DataFrame, train_end: int):
    """Fit scaling on training only. Preserve true zeros and original targets.

    Missing input counts are filled causally per zone. Missing targets remain masked.
    Local DST ambiguity must be documented upstream; UTC is preferred.
    """
    if not frame.index.is_unique or not frame.index.is_monotonic_increasing:
        raise ValueError('Demand timestamps must be unique and chronological')
    if not (0<train_end<len(frame)) or frame.shape[1]<1 or frame.columns.duplicated().any():
        raise ValueError('Invalid training boundary or zone IDs')
    if not isinstance(frame.index,pd.DatetimeIndex):raise ValueError('Demand index must be timestamps')
    if not ((frame.index[1:] - frame.index[:-1]) == pd.Timedelta(hours=1)).all():raise ValueError('Demand must have a continuous hourly index')
    raw=frame.to_numpy(dtype=np.float32)
    if np.isinf(raw).any() or (raw[np.isfinite(raw)]<0).any():raise ValueError('Counts must be nonnegative and finite or missing')
    valid=np.isfinite(raw)
    filled=frame.ffill().fillna(0).to_numpy(dtype=np.float32)
    log=np.log1p(filled);mu=log[:train_end].mean(0);sd=log[:train_end].std(0)
    sd=np.where(sd<1e-3,1,sd)
    return {'inputs':(log-mu)/sd,'targets':np.where(valid,raw,0),'valid':valid,'mu':mu,'sd':sd}
