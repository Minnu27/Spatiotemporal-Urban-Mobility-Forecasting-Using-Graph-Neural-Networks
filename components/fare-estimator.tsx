'use client';

import { useState, type FormEvent } from 'react';
import { ArrowUpRight } from 'lucide-react';
import zones from '@/data/zones.json';
import { fareSource } from '@/lib/fares';
import { tripHorizons } from '@/lib/horizons';
import type { TripQuote } from '@/lib/trip-fare';
import type { Forecast } from '@/lib/types';

const orderedZones = [...zones].sort((a, b) => a.name.localeCompare(b.name));
const boroughs = [...new Set(orderedZones.map(zone => zone.borough))].sort();
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const nyTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

function ZoneOptions({ allowNewark }: { allowNewark?: boolean }) {
  return <>
    <option value="">Choose a taxi zone</option>
    {boroughs.filter(borough => allowNewark || borough !== 'EWR').map(borough => (
      <optgroup key={borough} label={borough === 'EWR' ? 'New Jersey' : borough}>
        {orderedZones.filter(zone => zone.borough === borough).map(zone => (
          <option key={zone.id} value={zone.id}>{zone.name}</option>
        ))}
      </optgroup>
    ))}
  </>;
}

export default function FareEstimator({ forecast }: { forecast: Forecast | null }) {
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [horizon, setHorizon] = useState<number>(1);
  const [manual, setManual] = useState(false);
  const [details, setDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TripQuote | null>(null);
  const demand = forecast?.mode === 'live'
    ? forecast.rows.find(row => row.zoneId === Number(pickup) && row.horizon === horizon)
    : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const input = {
      pickup: Number(pickup), dropoff: Number(dropoff), horizon,
      congestion: fields.get('congestion'), tolls: Number(fields.get('tolls')),
      holiday: fields.get('holiday') === 'on',
      manual: manual ? {
        milesAbove12mph: Number(fields.get('miles')),
        slowMinutes: Number(fields.get('slow')),
      } : undefined,
    };
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const response = await fetch('/api/fare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(12000),
      });
      const quote = await response.json();
      if (!response.ok) {
        if (response.status >= 422) setDetails(true);
        setError(quote.error ?? 'The estimate is unavailable. Try again.');
        return;
      }
      setResult(quote);
    } catch {
      setError('The estimate is unavailable. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return <section className="panel fare-panel">
    <div className="panel-heading">
      <div>
        <h2>Estimate your yellow taxi fare</h2>
        <p>Choose where you’re going and when you plan to leave.</p>
      </div>
    </div>
    <div className="fare-layout trip-layout">
      <form onSubmit={submit} onChange={() => { setResult(null); setError(''); }}>
        <fieldset disabled={loading} className="trip-fields">
          <label>Pickup location
            <select required value={pickup} onChange={event => setPickup(event.target.value)}>
              <ZoneOptions />
            </select>
          </label>
          <label>Drop-off location
            <select required value={dropoff} onChange={event => setDropoff(event.target.value)}>
              <ZoneOptions allowNewark />
            </select>
          </label>
          <label>Leave in
            <select value={horizon} onChange={event => setHorizon(Number(event.target.value))}>
              {tripHorizons.map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'}</option>)}
            </select>
          </label>
          <details open={details} onToggle={event => setDetails(event.currentTarget.open)}>
            <summary>Fare details</summary>
            <label>Manhattan congestion charges
              <select name="congestion" defaultValue="unknown">
                <option value="unknown">Unsure · show a range</option>
                <option value="none">Neither charge applies</option>
                <option value="state">South of 96th Street only</option>
                <option value="both">Both charges apply</option>
              </select>
            </label>
            <label>Other tolls in USD
              <input name="tolls" type="number" min="0" max="100" step="0.01" placeholder="0.00" />
            </label>
            <label className="trip-checkbox"><input name="holiday" type="checkbox" /> Apply a special legal holiday</label>
            <label className="trip-checkbox">
              <input type="checkbox" checked={manual} onChange={event => setManual(event.target.checked)} />
              Enter distance and slow time myself
            </label>
            {manual && <>
              <label>Miles at 12 mph or faster
                <input name="miles" type="number" min="0" max="100" step="0.01" required />
              </label>
              <label>Minutes below 12 mph or stopped
                <input name="slow" type="number" min="0" max="180" step="0.01" required />
              </label>
            </>}
          </details>
          <button className="button primary" type="submit">{loading ? 'Calculating…' : 'Estimate fare'}</button>
        </fieldset>
        {error && <p role="alert" className="form-error">{error}</p>}
      </form>
      <div className="fare-total trip-total" aria-live="polite" aria-busy={loading}>
        {result ? <>
          <span>ESTIMATED FARE</span>
          <strong>{currency.format(result.total)}{result.maximum > result.total && <>–{currency.format(result.maximum)}</>}</strong>
          <p>Depart {nyTime.format(new Date(result.departure))}</p>
          {result.route && <p>{result.route.miles.toFixed(1)} mi · about {Math.round(result.route.minutes)} min between zone centers</p>}
          <div className="fare-breakdown">
            {result.breakdown.map(charge => <div key={charge.label}><span>{charge.label}</span><b>{currency.format(charge.amount)}</b></div>)}
            {result.maximum > result.total && <div><span>Possible Manhattan congestion charges</span><b>up to {currency.format(result.maximum - result.total)}</b></div>}
          </div>
          <p>Before tips and {result.tolls ? 'any additional' : 'other'} tolls.{result.newarkDropoff && ' Include return tolls for Newark.'}</p>
          {result.basis === 'route' && <p>Road speeds are typical routing speeds. Future traffic can change the metered fare.</p>}
          {demand && forecast && <p>
            Pickup-zone demand: {Math.round(demand.value)} predicted pickups for {nyTime.format(new Date(Date.parse(forecast.issuedAt) + horizon * 3600_000))}.
          </p>}
        </> : <p>Select pickup, drop-off and departure time to see a fare estimate.</p>}
        <a href={fareSource} target="_blank" rel="noreferrer">Official TLC fare rules <ArrowUpRight size={14} /></a>
      </div>
    </div>
  </section>;
}
