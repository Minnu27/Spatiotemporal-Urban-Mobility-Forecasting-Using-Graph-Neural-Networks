"""Build a weekly estimate profile from REAL hourly counts, without imputation.

Input: timestamp-indexed parquet or CSV with a timestamp column and 263 zone-ID
columns. This changes an estimation baseline; it does not train or validate GNNs.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demand', type=Path, required=True)
    parser.add_argument('--timestamp-column', default='timestamp')
    parser.add_argument('--timezone', default='America/New_York')
    parser.add_argument('--before', required=True, help='Exclusive cutoff; use only actual past observations')
    parser.add_argument('--min-samples', type=int, default=4)
    parser.add_argument('--require-months', type=int, default=12)
    parser.add_argument('--out', type=Path, default=Path('model/reference-profile.json'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    zone_ids = [zone['id'] for zone in json.loads((root/'model/metadata.json').read_text())['zones']]
    frame = pd.read_parquet(args.demand) if args.demand.suffix.lower()=='.parquet' else pd.read_csv(args.demand)
    if args.timestamp_column in frame:
        frame.index = pd.to_datetime(frame.pop(args.timestamp_column), errors='raise')
    if not isinstance(frame.index, pd.DatetimeIndex):
        raise ValueError('Use a DatetimeIndex or --timestamp-column; row numbers are not timestamps.')
    frame.columns = frame.columns.map(str)
    frame = frame[[str(zone) for zone in zone_ids]].apply(pd.to_numeric, errors='raise')
    index = frame.index
    if index.tz is None:
        index = index.tz_localize(args.timezone, ambiguous='NaT', nonexistent='NaT')
    index = index.tz_convert('America/New_York')
    frame.index = index
    cutoff = pd.Timestamp(args.before)
    cutoff = cutoff.tz_localize('America/New_York') if cutoff.tzinfo is None else cutoff.tz_convert('America/New_York')
    frame = frame.loc[frame.index.notna() & (frame.index < cutoff)].sort_index()
    whole_hours = (frame.index.minute==0)&(frame.index.second==0)&(frame.index.microsecond==0)&(frame.index.nanosecond==0)
    if frame.empty or frame.index.has_duplicates or not whole_hours.all():
        raise ValueError('Require unique, whole-hour observations before the cutoff.')
    values = frame.to_numpy(dtype=float)
    if np.isinf(values).any() or np.any(values[np.isfinite(values)] < 0):
        raise ValueError('Counts must be finite and nonnegative. Missing cells are excluded, never filled.')
    months = sorted(set(frame.index.month))
    if len(months) < args.require_months:
        raise ValueError(f'Found {len(months)} calendar months; require {args.require_months}. No months are fabricated.')
    how = frame.index.dayofweek*24 + frame.index.hour
    means = frame.groupby(how).mean().reindex(range(168))
    samples = frame.groupby(how).count().reindex(range(168), fill_value=0)
    if means.isna().any().any() or (samples < args.min_samples).any().any():
        raise ValueError('Not enough real samples in every hour/zone. Supply more observations.')
    result = {'source': f'Real hourly counts from {args.demand.name}; hour-of-week means over {len(frame)} rows and {len(months)} calendar months. No missing-value imputation.',
              'reference_start': frame.index[0].isoformat(), 'reference_end': frame.index[-1].isoformat(),
              'zone_ids': zone_ids, 'source_months': months, 'min_samples_per_cell': int(samples.min().min()),
              'rows': means.to_numpy().tolist()}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False)+'\n')
    print(f'Wrote {args.out}: 168 hours x {len(zone_ids)} zones; {len(months)} months. Still an estimate, not observed current demand.')

if __name__=='__main__':
    main()
