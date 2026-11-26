'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { fareSource } from '@/lib/fares';
import { tripHorizons } from '@/lib/horizons';
import type { PlannedTrip } from '@/lib/trip-planning';
import type { WeatherHour } from '@/lib/weather';
import type { Forecast } from '@/lib/types';
import TaxiZoneOptions, { type TripSelection } from './taxi-zone-options';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const nyTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

export default function FareEstimator({ initialTrip }: { initialTrip?: TripSelection }) {
  const [pickup, setPickup] = useState(initialTrip ? String(initialTrip.pickup) : '');
  const [dropoff, setDropoff] = useState(initialTrip ? String(initialTrip.dropoff) : '');
  const [retry, setRetry] = useState(0);
  const [horizon,setHorizon] = useState(initialTrip?.horizon ?? 1);
  const [forecast,setForecast]=useState<Forecast|null>(null);
  const [quote, setQuote] = useState<{key: string; result?: PlannedTrip; error?: string} | null>(null);
  const key = pickup && dropoff ? `${pickup}:${dropoff}:${horizon}:${retry}` : '';
  const current = key && quote?.key === key ? quote : null;
  const result = current?.result;
  const error = current?.error;
  const loading = Boolean(key && !current);
  const demand=forecast?.rows.find(row=>row.zoneId===Number(pickup)&&row.horizon===(horizon||1));

  useEffect(()=>{const controller=new AbortController();void fetch('/api/forecast',{cache:'no-store',signal:controller.signal}).then(r=>r.json()).then(setForecast).catch(()=>{});return()=>controller.abort();},[]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    async function loadQuote() {
      try {
        const response = await fetch('/api/fare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pickup: Number(pickup), dropoff: Number(dropoff), horizon }), signal,
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
  }, [pickup, dropoff, horizon, key]);

  return <section className="panel fare-panel">
    <div className="panel-heading">
      <div>
        <h2>Estimate your yellow taxi fare</h2>
        <p>Choose your route and departure time to compare traffic, weather and estimated cost.</p>
      </div>
    </div>
    <div className="fare-layout trip-layout">
      <div className="trip-fields">
        <label>Pickup location
          <select aria-label="Pickup location" value={pickup} onChange={event => setPickup(event.target.value)}>
            <TaxiZoneOptions />
          </select>
        </label>
        <label>Drop-off location
          <select aria-label="Drop-off location" value={dropoff} onChange={event => setDropoff(event.target.value)}>
            <TaxiZoneOptions allowNewark />
          </select>
        </label>
        <fieldset className="trip-departure">
          <legend>Departure time</legend>
          <div className="trip-horizons" role="group" aria-label="Departure time">
            {[0,...tripHorizons].map(hours=><button type="button" key={hours} aria-pressed={horizon===hours}
              className={horizon===hours?'active':''} onClick={()=>setHorizon(hours)}>
              {hours===0?'Leaving now':`${hours} ${hours===1?'hour':'hours'} ahead`}
            </button>)}
          </div>
          <p>Changing departure refreshes this route's fare and hourly weather forecast.</p>
        </fieldset>
        {pickup&&forecast&&<aside className="trip-demand" aria-label="Pickup demand context"><h3>{forecast.mode==='estimate'?'Current-demand estimate':forecast.mode==='historical'?'Historical demand replay':forecast.mode==='live'?'Observed-input demand forecast':'Demand estimate unavailable'}</h3>
          {demand&&<p><b>{Math.round(demand.value).toLocaleString('en-US')} estimated pickups</b> in the selected pickup zone for the hour starting {nyTime.format(new Date(Date.parse(forecast.issuedAt)+(horizon||1)*3600000))}.</p>}
          <p>{forecast.message}</p><p>Demand context does not add a surcharge to regulated taxi fares.</p>
          <details><summary>Demand source and timing</summary><p>{forecast.historySource}</p><p>Model origin: {nyTime.format(new Date(forecast.issuedAt))}. The estimate includes an assumed pickup count for the current input hour. Horizons predict individual target hours; trip departure uses the current time plus your selection.</p></details>
        </aside>}
      </div>
      <div className="fare-total trip-total" aria-live="polite" aria-busy={loading}>
        {result ? <>
          <span>TRIP PLANNING ESTIMATE</span>
          <strong>{currency.format(result.planningMinimum)}{result.planningMaximum > result.planningMinimum && <>–{currency.format(result.planningMaximum)}</>}</strong>
          <p>{horizon===0?'Leaving now':`Leaving in ${horizon} ${horizon===1?'hour':'hours'}`} · {nyTime.format(new Date(result.departure))}</p>
          {result.route && <p>{result.route.miles.toFixed(1)} mi · about {Math.round(result.route.minutes)} min between zone centers</p>}
          {result.route?.traffic==='static'&&<p>Static route estimate; departure traffic prediction is unavailable.</p>}
          {result.weatherAdjustment.state==='applied'&&<p className="weather-price-note">
            Weather sensitivity: {currency.format(result.weatherAdjustment.fareMinimum!)}–{currency.format(result.weatherAdjustment.fareMaximum!)}
            {' · '}{Math.round(result.weatherAdjustment.minutesMinimum!)}–{Math.round(result.weatherAdjustment.minutesMaximum!)} min.
            {result.basis==='flat'?' The flat fare is unchanged by modeled weather delay.':' The planning range includes possible extra slow travel time.'}
          </p>}
          <p>Traffic-only fare: {currency.format(result.total)}{result.maximum>result.total&&<>–{currency.format(result.maximum)}</>}. Breakdown below.</p>
          <div className="fare-breakdown">
            {result.breakdown.map(charge => <div key={charge.label}><span>{charge.label}</span><b>{currency.format(charge.amount)}</b></div>)}
            {result.maximum > result.total && <div><span>Possible Manhattan congestion charges</span><b>up to {currency.format(result.maximum - result.total)}</b></div>}
          </div>
          <p>Before tip. Actual traffic, addresses and route changes can affect the final fare.</p>
          {result.route && <p>Includes congestion charges and toll crossings detected on the estimated route.</p>}
          {!result.route && <p>Road routing is unavailable. Bridge and tunnel tolls are excluded.</p>}
        </> : loading ? <p>Checking departure traffic, weather and charges…</p> : error ? <>
          <p role="alert">{error}</p>
          {pickup !== dropoff && <button className="button secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>}
        </> : <p>Select a pickup and drop-off location to see your estimate.</p>}
        <a href={fareSource} target="_blank" rel="noreferrer">Official TLC fare rules <ArrowUpRight size={14} /></a>
      </div>
    </div>
    {result&&<section className="trip-weather" aria-labelledby="trip-weather-title">
      <div><h3 id="trip-weather-title">Weather at departure</h3><p>Hourly forecast for {nyTime.format(new Date(result.departure))}.</p></div>
      <div className="trip-weather-grid"><WeatherCard label="Pickup" weather={result.weather.pickup}/><WeatherCard label="Drop-off" weather={result.weather.dropoff}/></div>
      <p className="weather-method">{result.weatherAdjustment.state==='unavailable'?'A complete weather-based adjustment is unavailable; the estimate uses the route and published fares.':
        result.weatherAdjustment.state==='unsupported'?'These conditions fall outside the weather sensitivity model; the estimate uses the route and published fares.':
        result.weatherAdjustment.state==='dry'?'No rain, snow or fog adjustment is applied for this departure.':'The weather range is a planning scenario, not a calibrated NYC fare prediction. Traffic may already reflect weather.'}
        {' '}Weather affects the modeled travel time; there is no weather surcharge. Temperature and wind are shown for context. Conditions between zone centers may differ.</p>
      <div className="weather-sources"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather: Open-Meteo ↗</a><a href={result.weatherAdjustment.source} target="_blank" rel="noreferrer">Weather model basis: FHWA ↗</a></div>
    </section>}
  </section>;
}

function WeatherCard({label,weather}:{label:string;weather:WeatherHour|null}) {
  return <div className="trip-weather-card"><h4>{label}{weather&&<> · {weather.zone}</>}</h4>
    {weather?<><strong>{weather.condition} · {Math.round(weather.temperatureC)}°C</strong>
      <p>Precipitation {weather.precipitationMm.toFixed(1)} mm · Snow {weather.snowfallCm.toFixed(1)} cm · Wind {Math.round(weather.windKph)} km/h</p>
      <small>Forecast hour {nyTime.format(new Date(weather.at))} · retrieved {nyTime.format(new Date(weather.fetchedAt))}</small></>
      :<p>Weather forecast unavailable for this location and hour.</p>}
  </div>;
}
