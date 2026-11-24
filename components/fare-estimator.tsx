'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import zones from '@/data/zones.json';
import { fareSource } from '@/lib/fares';
import type { TripQuote } from '@/lib/trip-fare';

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

export default function FareEstimator() {
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [retry, setRetry] = useState(0);
  const [quote, setQuote] = useState<{key: string; result?: TripQuote; error?: string} | null>(null);
  const key = pickup && dropoff ? `${pickup}:${dropoff}:${retry}` : '';
  const current = key && quote?.key === key ? quote : null;
  const result = current?.result;
  const error = current?.error;
  const loading = Boolean(key && !current);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    async function loadQuote() {
      try {
        const response = await fetch('/api/fare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pickup: Number(pickup), dropoff: Number(dropoff) }), signal,
        });
        const data = await response.json();
        if (!controller.signal.aborted) {
          setQuote(response.ok ? { key, result: data } : { key, error: data.error ?? 'The estimate is unavailable.' });
        }
      } catch {
        if (!controller.signal.aborted) setQuote({ key, error: 'The estimate is unavailable.' });
      }
    }
    void loadQuote();
    return () => controller.abort();
  }, [pickup, dropoff, key]);

  return <section className="panel fare-panel">
    <div className="panel-heading">
      <div>
        <h2>Estimate your yellow taxi fare</h2>
        <p>Choose two taxi zones to see the estimated fare for a trip leaving now.</p>
      </div>
    </div>
    <div className="fare-layout trip-layout">
      <div className="trip-fields">
        <label>Pickup location
          <select value={pickup} onChange={event => setPickup(event.target.value)}>
            <ZoneOptions />
          </select>
        </label>
        <label>Drop-off location
          <select value={dropoff} onChange={event => setDropoff(event.target.value)}>
            <ZoneOptions allowNewark />
          </select>
        </label>
      </div>
      <div className="fare-total trip-total" aria-live="polite" aria-busy={loading}>
        {result ? <>
          <span>ESTIMATED FARE</span>
          <strong>{currency.format(result.total)}{result.maximum > result.total && <>–{currency.format(result.maximum)}</>}</strong>
          <p>Leaving now · {nyTime.format(new Date(result.departure))}</p>
          {result.route && <p>{result.route.miles.toFixed(1)} mi · about {Math.round(result.route.minutes)} min between zone centers</p>}
          <div className="fare-breakdown">
            {result.breakdown.map(charge => <div key={charge.label}><span>{charge.label}</span><b>{currency.format(charge.amount)}</b></div>)}
            {result.maximum > result.total && <div><span>Possible Manhattan congestion charges</span><b>up to {currency.format(result.maximum - result.total)}</b></div>}
          </div>
          <p>Before tip. Actual traffic, addresses and route changes can affect the final fare.</p>
          {result.route && <p>Includes congestion charges and toll crossings detected on the estimated route.</p>}
          {!result.route && <p>Road routing is unavailable. Bridge and tunnel tolls are excluded.</p>}
        </> : loading ? <p>Checking the route and charges…</p> : error ? <>
          <p role="alert">{error}</p>
          {pickup !== dropoff && <button className="button secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>}
        </> : <p>Select a pickup and drop-off location to see your estimate.</p>}
        <a href={fareSource} target="_blank" rel="noreferrer">Official TLC fare rules <ArrowUpRight size={14} /></a>
      </div>
    </div>
  </section>;
}
