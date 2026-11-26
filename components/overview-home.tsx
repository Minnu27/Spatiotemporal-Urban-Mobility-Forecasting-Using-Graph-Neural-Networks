'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ArrowUpDown, Clock3, Compass, GitBranch, MapPin, MessageSquare, Route, ShieldCheck } from 'lucide-react';
import CityScene from './city-scene';
import TaxiZoneOptions, { type TripSelection } from './taxi-zone-options';

export default function OverviewHome({ selected, onSelect, onPlan, onNavigate, onAsk }: {
  selected: number; onSelect: (zone: number) => void; onPlan: (trip: TripSelection) => void;
  onNavigate: (tab: 'Disruptions' | 'Research' | 'Trip costs') => void; onAsk: () => void;
}) {
  const [pickup, setPickup] = useState(String(selected));
  const [dropoff, setDropoff] = useState('132');
  useEffect(()=>{setPickup(selected===1?'':String(selected));},[selected]);
  const same = Boolean(pickup && pickup === dropoff);
  function swap() { if (dropoff === '1') return; setPickup(dropoff); setDropoff(pickup); }
  return <>
    <section className="home-hero" aria-labelledby="home-title">
      <div className="hero-explore">
        <div className="hero-kicker"><span className="hero-badge"><Compass size={13}/>YOUR CITY. IN PERSPECTIVE.</span><span>NYC / 01</span></div>
        <h1 id="home-title">A smarter way<br/>to <em>move through NYC.</em></h1>
        <p className="hero-description">Find your route. See what’s changing.<br/>Make your next move with a clearer picture.</p>
        <CityScene selected={selected} onSelect={onSelect}/>
        <a className="hero-map-link" href="#city-explorer">Explore the zone map <ArrowDown size={15}/></a>
      </div>
      <div className="quick-planner">
        <div className="planner-heading"><span className="planner-icon"><Route size={22}/></span><span className="planner-step">01 / PLAN AHEAD</span></div>
        <h2>Where are you headed?</h2><p>A little planning. A better trip.</p>
        <form onSubmit={event=>{event.preventDefault();if(pickup&&dropoff&&!same)onPlan({pickup:Number(pickup),dropoff:Number(dropoff),horizon:1});}}>
          <div className="quick-route-fields">
            <label htmlFor="quick-pickup"><span className="route-dot"/>Pickup zone</label>
            <select id="quick-pickup" value={pickup} onChange={event=>setPickup(event.target.value)} required><TaxiZoneOptions/></select>
            <div className="route-connector"><i/><button type="button" aria-label="Swap pickup and drop-off" onClick={swap} disabled={!pickup||!dropoff||dropoff==='1'}><ArrowUpDown size={16}/></button></div>
            <label htmlFor="quick-dropoff"><MapPin size={14}/>Drop-off zone</label>
            <select id="quick-dropoff" value={dropoff} onChange={event=>setDropoff(event.target.value)} required><TaxiZoneOptions allowNewark/></select>
          </div>
          <div className="planner-schedule"><Clock3 size={18}/><div><b>Plan around your schedule</b><p>Compare departure times and hourly weather in Trip costs, up to 24 hours ahead.</p></div></div>
          {same&&<p className="quick-route-error" role="alert">Choose a different drop-off zone to plan your trip.</p>}
          <button className="plan-trip-button" type="submit" disabled={!pickup||!dropoff||same}>See trip estimate <ArrowRight size={18}/></button>
          <p className="planner-footnote"><ShieldCheck size={14}/><span>Published taxi rates. Hourly weather.<br/>Clear assumptions with every estimate.</span></p>
        </form>
        <div className="planner-bottom"><span>Made for your next move</span><span>NYC <ArrowUpRight size={13}/></span></div>
      </div>
    </section>
    <div className="home-shortcuts" aria-label="Explore UrbanFlow">
      <button onClick={()=>onNavigate('Disruptions')}><span className="shortcut-icon"><Compass size={21}/></span><span><b>Check the network</b><small>Official transit & road reports</small></span><ArrowUpRight size={17}/></button>
      <button onClick={onAsk}><span className="shortcut-icon"><MessageSquare size={21}/></span><span><b>Ask UrbanFlow</b><small>Your mobility questions, answered</small></span><ArrowUpRight size={17}/></button>
      <button onClick={()=>onNavigate('Research')}><span className="shortcut-icon"><GitBranch size={21}/></span><span><b>Explore the evidence</b><small>18 models. Five forecast horizons.</small></span><ArrowUpRight size={17}/></button>
    </div>
  </>;
}
