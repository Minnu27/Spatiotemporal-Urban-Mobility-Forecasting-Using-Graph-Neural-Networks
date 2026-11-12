"""Rebuild analysis inputs from official TLC data (large downloads).

This preserves true zero counts and masks DST transition labels rather than
inventing their targets. TLC local timestamps cannot disambiguate fall-back trips.
OD/correlation graphs fit only records before --train-end.
"""
import argparse,json,pathlib,urllib.request
import numpy as np
import pandas as pd
from .validation import validate_graph
BASE='https://d37ci6vzurychx.cloudfront.net/'

def topk(matrix,k):
    a=np.asarray(matrix,dtype=float).copy();np.fill_diagonal(a,0)
    k=min(k,len(a)-1);indices=np.argsort(-a,axis=1)[:,:k]
    out=np.zeros_like(a);np.put_along_axis(out,indices,np.take_along_axis(a,indices,axis=1),axis=1)
    out/=np.maximum(out.max(1,keepdims=True),1e-9)
    return np.maximum(out,out.T)

def prepare(args):
    # Zone geography is distributed with the web app; coordinates are display centroids.
    root=pathlib.Path(__file__).resolve().parents[2]
    zones=json.loads((root/'data/zones.json').read_text());zone_ids=[z['id'] for z in zones];pos={z:i for i,z in enumerate(zone_ids)}
    args.out.mkdir(parents=True,exist_ok=True);od=np.zeros((len(zones),len(zones)));matrices=[];quality=[]
    for month in range(1,13):
        print('Processing',args.year,month,flush=True)
        filename=f'yellow_tripdata_{args.year}-{month:02d}.parquet';path=args.out/filename
        if not path.exists():
            with urllib.request.urlopen(BASE+'trip-data/'+filename,timeout=120) as source,path.open('wb') as target:
                while chunk:=source.read(1024*1024):target.write(chunk)
        columns=['tpep_pickup_datetime','tpep_dropoff_datetime','PULocationID','DOLocationID','trip_distance','fare_amount','payment_type']
        t=pd.read_parquet(path,columns=columns);start=pd.Timestamp(args.year,month,1);end=start+pd.DateOffset(months=1)
        base=(t.tpep_pickup_datetime>=start)&(t.tpep_pickup_datetime<end)&t.PULocationID.isin(zone_ids)
        zero=t.tpep_dropoff_datetime<=t.tpep_pickup_datetime
        phantom=zero&((t.payment_type==6)|(t.fare_amount<0)|((t.trip_distance<=0)&(t.fare_amount<=0)))
        keep=base&~phantom;clean=t.loc[keep]
        hourly=clean.groupby([clean.tpep_pickup_datetime.dt.floor('h'),'PULocationID']).size().unstack(fill_value=0)
        hourly=hourly.reindex(index=pd.date_range(start,end,freq='h',inclusive='left'),columns=zone_ids,fill_value=0)
        assert hourly.to_numpy().sum()==int(keep.sum())
        matrices.append(hourly)
        flow=t.loc[base&(t.tpep_pickup_datetime<pd.Timestamp(args.train_end))&(t.tpep_dropoff_datetime>t.tpep_pickup_datetime)&t.DOLocationID.isin(zone_ids)]
        pairs=flow.groupby(['PULocationID','DOLocationID']).size()
        for (a,b),count in pairs.items():od[pos[a],pos[b]]+=count
        quality.append({'month':month,'rows':len(t),'retained':int(keep.sum()),'phantom_removed':int((base&phantom).sum())})
        if not args.keep_downloads:path.unlink()
    demand=pd.concat(matrices).astype(float)
    # Identify DST labels via zoneinfo rather than hardcoded 2025 transitions.
    localized=demand.index.tz_localize('America/New_York',ambiguous='NaT',nonexistent='NaT')
    demand.loc[localized.isna(),:]=np.nan
    demand.rename(columns=str).to_parquet(args.out/'demand.parquet')
    tr=demand.loc[demand.index<pd.Timestamp(args.train_end)].ffill().fillna(0)
    how=tr.index.dayofweek*24+tr.index.hour;log=np.log1p(tr);residual=log-log.groupby(how).transform('mean')
    with np.errstate(invalid='ignore',divide='ignore'):corr=np.nan_to_num(np.corrcoef(residual.to_numpy().T),nan=0,posinf=0,neginf=0)
    # Distance graph uses representative display centroids; contiguity must come from true geometry.
    from scipy.spatial.distance import cdist
    coords=np.array([[z['longitude']*np.cos(np.deg2rad(40.7)),z['latitude']] for z in zones])*111.195
    d=cdist(coords,coords);nearest=np.argsort(d,axis=1)[:,1:9];sigma=np.take_along_axis(d,nearest,1).mean()
    a_dist=np.zeros_like(d);np.put_along_axis(a_dist,nearest,np.exp(-(np.take_along_axis(d,nearest,1)/sigma)**2),axis=1);a_dist=np.maximum(a_dist,a_dist.T)
    # Official polygon contiguity; require optional geospatial extras to avoid inventing edges.
    import geopandas as gpd
    shape=args.out/'taxi_zones.zip'
    if not shape.exists():urllib.request.urlretrieve(BASE+'misc/taxi_zones.zip',shape)
    gdf=gpd.read_file('zip://'+str(shape.resolve())).to_crs(2263).dissolve(by='LocationID').reindex(zone_ids)
    if gdf.geometry.isna().any():raise ValueError('Missing official zone geometry')
    geometry=gdf.geometry.buffer(50)
    a_adj=np.array([geometry.intersects(g).to_numpy() for g in geometry],dtype=float);np.fill_diagonal(a_adj,0)
    for i in np.where(a_adj.sum(1)==0)[0]:
        for j in np.argsort(d[i])[1:4]:a_adj[i,j]=a_adj[j,i]=1
    graphs={'A_adj':a_adj,'A_dist':a_dist,'A_od':topk(np.log1p(od+od.T),10),'A_corr':topk(np.maximum(corr,0),10)}
    np.savez(args.out/'graphs.npz',zone_ids=np.array(zone_ids),**graphs)
    report={'quality':quality,'masked_dst_labels':[str(d) for d in demand.index[localized.isna()]],'train_end':args.train_end,'graph_audits':{k:validate_graph(a,zone_ids) for k,a in graphs.items()},'distance_note':'Approximate distances from representative display centroids; not road travel distances.'}
    (args.out/'preparation.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--year',type=int,default=2025);p.add_argument('--train-end',default='2025-10-01');p.add_argument('--out',type=pathlib.Path,default=pathlib.Path('artifacts/data'));p.add_argument('--keep-downloads',action='store_true');prepare(p.parse_args())
