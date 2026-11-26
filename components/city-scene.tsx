'use client';

import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, LocateFixed, MoveHorizontal, Pause, Play } from 'lucide-react';

// A deliberately schematic city, independent of the geographic TLC map below.
const buildings = [
  [62,72,24,26,35],[98,72,22,26,53],[134,72,27,26,28],[178,72,26,26,62],
  [62,116,24,25,27],[101,116,22,25,75],[137,116,27,25,40],[179,116,26,25,92],
  [62,159,24,25,46],[101,159,22,25,103],[137,159,27,25,68],[179,159,26,25,51],
  [62,204,24,24,24],[101,204,22,24,43],[137,204,27,24,58],[179,204,26,24,30],
  [283,158,29,29,36],[325,158,23,29,24],[283,201,29,27,52],[325,201,23,27,39],
  [283,242,29,25,26],[325,242,23,25,19],[366,218,25,26,33],[366,260,25,24,22],
];

export default function CityScene({ selected, onSelect }: { selected: number; onSelect: (zone: number) => void }) {
  const [rotation, setRotation] = useState(-29);
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ x: number; rotation: number } | null>(null);
  function start(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = { x: event.clientX, rotation };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setRotation(Math.max(-65, Math.min(15, drag.current.rotation + (event.clientX - drag.current.x) * .22)));
  }
  function end() { drag.current = null; }
  return <div className={`city-experience ${paused ? 'city-paused' : ''}`}>
    <div className="city-stage" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="city-coordinates" aria-hidden="true"><span>40°45′ N</span><span>73°59′ W</span></div>
      <div className="city-world" style={{ '--city-rotation': `${rotation}deg` } as CSSProperties} aria-hidden="true">
        <svg className="city-ground" viewBox="0 0 450 340">
          <defs><pattern id="city-grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#47675c" strokeWidth=".5"/></pattern></defs>
          <rect x="2" y="2" width="446" height="336" rx="30" fill="#153f35" stroke="#44695c"/>
          <rect x="2" y="2" width="446" height="336" rx="30" fill="url(#city-grid)"/>
          <path d="M31 52H222V246L193 281H31Z M268 140H410V306H268Z" fill="#31584a" stroke="#607f65"/>
          <path d="M244 10L241 117L246 255L222 332" fill="none" stroke="#285b56" strokeWidth="30"/>
          <path d="M90 52V246M128 52V246M170 52V246M31 107H222M31 151H222M31 194H222M268 194H410M268 235H410M318 140V306M359 140V306" fill="none" stroke="#94ab85" strokeWidth="2" opacity=".6"/>
          <path d="M50 151H246L283 194H395" fill="none" stroke="#dce8a4" strokeWidth="3"/>
          <path d="M50 151H246L283 194H395" fill="none" stroke="#f1fac7" strokeWidth="6" strokeDasharray="2 75" className="city-flow"/>
          <rect x="51" y="237" width="77" height="24" rx="4" fill="#759565"/>
          <circle cx="384" cy="98" r="25" fill="#204b40" stroke="#60806a"/>
          <path d="M372 98H396M384 86V110" stroke="#a8c189"/>
        </svg>
        {buildings.map(([x,y,width,depth,height], index) => <div key={index} className={`city-building building-${index % 4}`} style={{ left:x,top:y,'--w':`${width}px`,'--d':`${depth}px`,'--h':`${height}px` } as CSSProperties}>
          <i className="building-roof"/><i className="building-front"/><i className="building-side"/><i className="building-right"/><i className="building-back"/>
        </div>)}
        <div className="city-beacon" style={{left:190,top:125}}/><div className="city-beacon secondary-beacon" style={{left:294,top:214}}/>
      </div>
      <div className="city-floating-label"><span className="status-dot"/> NEW YORK CITY <span className="city-label-line"/> <b>5 boroughs</b></div>
      <span className="city-drag-hint"><MoveHorizontal size={13}/>Drag to explore</span>
    </div>
    <div className="city-tools"><div role="group" aria-label="Rotate illustrative city">
      <button type="button" aria-label="Rotate city left" onClick={()=>setRotation(value=>Math.max(-65,value-10))}><ArrowLeft size={16}/></button>
      <button type="button" aria-label="Reset city view" onClick={()=>setRotation(-29)}><LocateFixed size={16}/></button>
      <button type="button" aria-label="Rotate city right" onClick={()=>setRotation(value=>Math.min(15,value+10))}><ArrowRight size={16}/></button>
      <button type="button" aria-label={paused?'Play city animation':'Pause city animation'} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button>
    </div><span>Illustrative 3D city · not a traffic map</span></div>
    <div className="city-destinations" role="group" aria-label="Explore a taxi zone">
      {[{id:161,name:'Midtown'},{id:33,name:'Brooklyn Heights'},{id:132,name:'JFK Airport'}].map(zone=><button type="button" key={zone.id} aria-pressed={selected===zone.id} onClick={()=>onSelect(zone.id)}><span/>{zone.name}<ArrowRight size={13}/></button>)}
    </div>
  </div>;
}
