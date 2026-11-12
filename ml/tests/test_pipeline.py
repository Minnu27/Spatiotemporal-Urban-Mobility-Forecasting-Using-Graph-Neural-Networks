import numpy as np
import pandas as pd
import pytest
import torch
from mobility.validation import validate_graph,normalize_graph,metrics,forecast_origins
from mobility.preprocessing import prepare_counts
from mobility.models import GCNGRU,GraphWaveNet,NodeGRU

def test_graph_validation_and_isolation():
    a=np.array([[0,1,0],[1,0,0],[0,0,0]],dtype=float)
    report=validate_graph(a,[1,2,3]);assert report['edges']==1;assert report['isolated_zone_ids']==[3];assert report['components']==2
    normalized=normalize_graph(a);assert np.isfinite(normalized).all();assert normalized[2,2]==1
    for bad in [a+np.eye(3),np.array([[0,np.nan,0],[1,0,0],[0,0,0]]),-a]:
        with pytest.raises(ValueError):validate_graph(bad,[1,2,3])
    with pytest.raises(ValueError):validate_graph(a,[1,1,3])

def test_future_mutations_do_not_change_train_inputs_or_scaling():
    frame=pd.DataFrame(np.arange(120).reshape(40,3),index=pd.date_range('2025-01-01',periods=40,freq='h'))
    a=prepare_counts(frame,20);frame.iloc[20:]=999999;b=prepare_counts(frame,20)
    np.testing.assert_array_equal(a['inputs'][:20],b['inputs'][:20]);np.testing.assert_array_equal(a['mu'],b['mu']);np.testing.assert_array_equal(a['sd'],b['sd'])

def test_true_zeros_preserved_and_missing_values_filled_causally():
    frame=pd.DataFrame({'1':[0,5,np.nan,12,14,0]},index=pd.date_range('2025-01-01',periods=6,freq='h'))
    a=prepare_counts(frame,4)
    assert a['targets'][0,0]==0 and a['valid'][0,0]
    assert not a['valid'][2,0]
    assert a['inputs'][2,0]==a['inputs'][1,0]
    frame.iloc[3]=9999;b=prepare_counts(frame,4)
    # Inverse-transform before comparison: scaler fits training, but filled observation stays past-only.
    assert np.isclose(np.expm1(b['inputs'][2,0]*b['sd'][0]+b['mu'][0]),5)

def test_split_windows_never_cross_boundaries():
    splits=forecast_origins(100,50,75,12,6)
    assert (splits['train']+6<50).all()
    assert (splits['validation']+1>=50).all() and (splits['validation']+6<75).all()
    assert (splits['test']+1>=75).all() and (splits['test']+6<100).all()

def test_metrics_mask_and_nonfinite_rejection():
    assert metrics([0,0],[1,2])['wape'] is None
    assert metrics([2,4],[2,4])['mae']==0
    assert metrics([2,999],[3,0],[True,False])['mae']==1
    with pytest.raises(ValueError):metrics([1],[np.nan])
    with pytest.raises(ValueError):metrics([1],[1],[False])

@pytest.mark.parametrize('kind',['gru','gcn','gwn'])
def test_model_forward_backward_and_graph_normalization(kind):
    torch.set_num_threads(2);torch.manual_seed(1)
    a=np.array([[0,1,0],[1,0,1],[0,1,0]],dtype=np.float32)
    model=NodeGRU(3,4,hidden=8,horizon=6) if kind=='gru' else GCNGRU(3,4,normalize_graph(a),hidden=8,horizon=6) if kind=='gcn' else GraphWaveNet(3,4,[normalize_graph(a)],res_ch=8,dil_ch=8,skip_ch=16,end_ch=16,horizon=6)
    model.train();out=model(torch.randn(2,12,3),torch.randn(2,12,4));assert out.shape==(2,6,3);assert torch.isfinite(out).all()
    out.square().mean().backward();assert any(p.grad is not None and p.grad.abs().sum()>0 for p in model.parameters())
    if kind=='gwn':assert torch.allclose(model.adaptive_adj().sum(1),torch.ones(3))
