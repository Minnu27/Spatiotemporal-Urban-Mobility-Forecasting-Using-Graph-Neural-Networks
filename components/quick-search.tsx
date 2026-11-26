'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, LayoutDashboard, MapPin, Search, X } from 'lucide-react';
import zones from '@/data/zones.json';
import type { Incident } from '@/lib/types';

export type DashboardTab = 'Overview' | 'Disruptions' | 'Research' | 'Trip costs';

export default function QuickSearch({ onClose, onNavigate, onZone, onReport, incidents }: {
  onClose: () => void; onNavigate: (tab: DashboardTab) => void; onZone: (id: number) => void;
  onReport: (title: string) => void; incidents: Incident[];
}) {
  const [query,setQuery] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(()=>{
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; input.current?.focus();
    return ()=>{document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  const results = useMemo(()=>{
    const text=query.trim().toLowerCase();
    return {
      pages: (['Overview','Trip costs','Disruptions','Research'] as DashboardTab[]).filter(tab=>!text||tab.toLowerCase().includes(text)),
      zones: zones.filter(zone=>text&&`${zone.name} ${zone.borough} ${zone.id}`.toLowerCase().includes(text)).slice(0,6),
      reports: incidents.filter(report=>text&&`${report.title} ${report.routes.join(' ')}`.toLowerCase().includes(text)).slice(0,3),
    };
  },[query,incidents]);
  const count=results.pages.length+results.zones.length+results.reports.length;
  function keydown(event:KeyboardEvent<HTMLDivElement>) {
    if(event.key==='Escape'){event.preventDefault();onClose();}
    if(event.key==='Tab'){
      const elements=dialog.current?.querySelectorAll<HTMLElement>('input,button');
      if(!elements?.length)return;
      if(event.shiftKey&&document.activeElement===elements[0]){event.preventDefault();elements[elements.length-1].focus();}
      else if(!event.shiftKey&&document.activeElement===elements[elements.length-1]){event.preventDefault();elements[0].focus();}
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const items=[input.current,...Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('.search-result')??[])].filter(Boolean) as HTMLElement[];
      const index=items.indexOf(document.activeElement as HTMLElement);
      items[(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
    }
  }
  return <div className="search-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="search-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="search-title" onKeyDown={keydown}>
      <div className="search-input-row"><Search size={21}/><label className="sr-only" id="search-title" htmlFor="urban-search">Search UrbanFlow</label><input ref={input} id="urban-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search zones, reports, or pages…" autoComplete="off"/><button aria-label="Close search" onClick={onClose}><X size={18}/></button></div>
      <div className="search-results">
        {!!results.pages.length&&<><h2>WORKSPACE</h2>{results.pages.map(tab=><button className="search-result" key={tab} onClick={()=>{onNavigate(tab);onClose();}}><LayoutDashboard size={17}/><span>{tab}</span><ArrowUpRight size={15}/></button>)}</>}
        {!!results.zones.length&&<><h2>TAXI ZONES</h2>{results.zones.map(zone=><button className="search-result" key={zone.id} onClick={()=>{onZone(zone.id);onClose();}}><MapPin size={17}/><span>{zone.name}<small>{zone.borough} · Zone {zone.id}</small></span><ArrowUpRight size={15}/></button>)}</>}
        {!!results.reports.length&&<><h2>CURRENT REPORTS</h2>{results.reports.map(report=><button className="search-result" key={report.id} onClick={()=>{onReport(report.title);onClose();}}><span>{report.title}<small>{report.source}</small></span><ArrowUpRight size={15}/></button>)}</>}
        {!count&&<p className="search-empty">No matches. Try a zone name, borough, route, or “Trip costs”.</p>}
      </div><div className="search-help"><span><kbd>↑</kbd><kbd>↓</kbd> to explore <kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>
    </div>
  </div>;
}
