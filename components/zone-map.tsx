'use client';
import geometry from '@/data/geography.json';
import zones from '@/data/zones.json';
import type { Impact } from '@/lib/types';
const project=([lon,lat]:number[])=>[(lon+74.26)/.57*700,(40.94-lat)/.46*570];
export default function ZoneMap({selected,onSelect,impacts,borough}:{selected:number;onSelect:(id:number)=>void;impacts:Impact[];borough:string}){
  const map=new Map(impacts.map(i=>[i.zoneId,i]));
  return <div className="map-frame"><svg viewBox="0 0 700 570" role="img" aria-label="Interactive map of the 263 official TLC taxi zones">
    <defs><pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M 35 0 L 0 0 0 35" fill="none" stroke="#c8d8d6" strokeWidth=".4"/></pattern></defs>
    <rect width="700" height="570" fill="#eaf1ee"/><rect width="700" height="570" fill="url(#grid)"/>
    <text x="70" y="295" className="water-label" transform="rotate(-60 70 295)">HUDSON RIVER</text>
    {geometry.map(g=>{const z=zones.find(v=>v.id===g.id)!;const impact=map.get(g.id);const dim=borough!=='All boroughs'&&z.borough!==borough;
      const d=g.rings.map(r=>'M'+r.map(p=>project(p).join(',')).join('L')+'Z').join(' ');
      return <path key={g.id} d={d} tabIndex={dim?-1:0} role="button" aria-label={`${z.name}, ${z.borough}${impact?`, disruption score ${impact.score}`:''}`} aria-pressed={selected===g.id}
        onClick={()=>onSelect(g.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(g.id);}}}
        fill={selected===g.id?'#142f2b':dim?'#d9e3dc':impact&&impact.score>=60?'#d48750':impact&&impact.score>=25?'#d0ac63':'#98b9a4'}
        stroke={selected===g.id?'#f6c969':'#f9fbf7'} strokeWidth={selected===g.id?2:0.6} className="zone-path"><title>{z.name} · {z.borough}</title></path>;
    })}
    <g className="map-labels"><text x="250" y="180" transform="rotate(-54 250 180)">MANHATTAN</text><text x="395" y="310">QUEENS</text><text x="260" y="395">BROOKLYN</text><text x="405" y="95">BRONX</text><text x="60" y="495">STATEN ISLAND</text></g>
    <g transform="translate(622 28)"><path d="M0 27 L8 0 L16 27 L8 21Z" fill="#243e32"/><text x="4" y="43" fontSize="11" fill="#243e32">N</text></g>
    <g transform="translate(535 525)"><path d="M0 0v6h100v-6M50 0v6" fill="none" stroke="#52665c"/><text y="21" fontSize="10" fill="#52665c">Approx. 5 km</text></g>
  </svg><div className="map-attribution">NYC TLC zone boundaries · schematic projection · not a road-routing map</div></div>;
}
