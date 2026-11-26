import zones from '@/data/zones.json';

const ordered = [...zones].sort((a, b) => a.name.localeCompare(b.name));
const boroughs = [...new Set(ordered.map(zone => zone.borough))].sort();

export type TripSelection = { pickup: number; dropoff: number; horizon: number };

export default function TaxiZoneOptions({ allowNewark = false }: { allowNewark?: boolean }) {
  return <>
    <option value="">Choose a taxi zone</option>
    {boroughs.filter(borough => allowNewark || borough !== 'EWR').map(borough => (
      <optgroup key={borough} label={borough === 'EWR' ? 'New Jersey' : borough}>
        {ordered.filter(zone => zone.borough === borough).map(zone => (
          <option key={zone.id} value={zone.id}>{zone.name}</option>
        ))}
      </optgroup>
    ))}
  </>;
}
