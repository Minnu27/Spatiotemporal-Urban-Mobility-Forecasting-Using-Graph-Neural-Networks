'use client';

import { Download } from 'lucide-react';
import zones from '@/data/zones.json';
import { tripHorizons } from '@/lib/horizons';
import type { Forecast, Zone } from '@/lib/types';

const nyTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const counts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export default function ForecastPanel({ forecast, loading, zone, horizon, onHorizon, onZone }: {
  forecast: Forecast | null; loading: boolean; zone: Zone; horizon: number;
  onHorizon: (hours: number) => void; onZone: (id: number) => void;
}) {
  const rows = tripHorizons.map(hours => ({
    hours, row: forecast?.rows.find(row => row.zoneId === zone.id && row.horizon === hours),
  }));
  const selected = rows.find(row => row.hours === horizon)?.row;
  const origin = forecast && forecast.mode !== 'unavailable' ? Date.parse(forecast.issuedAt) : NaN;
  const target = (hours: number) => new Date(origin + hours * 3600_000);
  const hasOrigin = Number.isFinite(origin);

  function exportForecast() {
    if (!forecast || !hasOrigin) return;
    const data = {
      zone: { id: zone.id, name: zone.name }, mode: forecast.mode, model: forecast.model,
      issuedAt: forecast.issuedAt, historySource: forecast.historySource,
      predictions: rows.filter(row => row.row).map(({ hours, row }) => ({
        horizon: hours, targetHour: target(hours).toISOString(), pickups: row!.value,
      })),
      note: 'Each prediction is for one target hour, not the total pickups over the horizon. Historical replay is not a current travel forecast.',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `urbanflow-zone-${zone.id}-forecast.json`; link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="panel forecast-panel" aria-labelledby="forecast-title">
    <div className="panel-heading">
      <div><h2 id="forecast-title">Taxi demand forecast</h2><p>Choose how many hours ahead to forecast pickups in a taxi zone.</p></div>
      <label className="forecast-zone">Taxi zone
        <select aria-label="Forecast taxi zone" value={zone.id} onChange={event => onZone(Number(event.target.value))}>
          {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
        </select>
      </label>
    </div>
    <div className="forecast-controls">
      <span id="forecast-horizon-label">Forecast ahead</span>
      <div className="segmented forecast-horizons" role="group" aria-labelledby="forecast-horizon-label">
        {tripHorizons.map(hours => <button key={hours} type="button" aria-pressed={horizon === hours}
          className={horizon === hours ? 'active' : ''} onClick={() => onHorizon(hours)}>
          {hours} {hours === 1 ? 'hour' : 'hours'}
        </button>)}
      </div>
      <button className="button secondary" type="button" onClick={exportForecast}
        disabled={!hasOrigin || !rows.some(row => row.row)}><Download size={14}/>Export forecast</button>
    </div>
    <div className="forecast-summary" role="status" aria-live="polite">
      {selected ? <><strong>{counts.format(selected.value)} <small>predicted pickups</small></strong>
        <p>{zone.name} · {horizon} {horizon === 1 ? 'hour' : 'hours'} ahead{hasOrigin && <> · {nyTime.format(target(horizon))}</>}</p></>
        : <p>{loading ? 'Loading demand forecast…' : 'Forecast unavailable for this zone and horizon.'}</p>}
    </div>
    <dl className="forecast-comparison" aria-label="Forecast results by horizon">
      {rows.map(({ hours, row }) => <div key={hours} className={hours === horizon ? 'selected' : ''}>
        <dt>+{hours}h</dt><dd>{row ? counts.format(row.value) : '—'} <small>pickups</small></dd>
        {hasOrigin && <dd className="forecast-target"><time dateTime={target(hours).toISOString()}>{nyTime.format(target(hours))}</time></dd>}
      </div>)}
    </dl>
    <p className="forecast-provenance">{forecast?.mode === 'historical'
      ? 'Historical replay · held-out 2025 observations. These results are not a forecast for today.'
      : forecast?.mode === 'live' ? 'Forecast based on recent observed demand.' : loading ? 'Connecting to the demand model.' : forecast?.message || 'The forecast service could not be reached. Try Refresh.'}
      {hasOrigin && <> Observations end {nyTime.format(new Date(origin))}. Model: {forecast?.model}.</>}
      {' '}Each value predicts one target hour, not a cumulative total.</p>
  </section>;
}
