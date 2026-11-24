import geography from '@/data/geography.json';
import reliefZone from '@/data/congestion-relief-zone.json';
import zones from '@/data/zones.json';

export type Point = readonly number[];
type Ring = readonly Point[];

const islands = new Set([103, 104, 105, 194, 202, 153]);
const manhattan = new Set(zones.filter(zone => zone.borough === 'Manhattan' && !islands.has(zone.id)).map(zone => zone.id));
const manhattanRings = geography.filter(zone => manhattan.has(zone.id)).flatMap(zone => zone.rings).map(ring => ({
  ring,
  west: Math.min(...ring.map(point => point[0])),
  east: Math.max(...ring.map(point => point[0])),
  south: Math.min(...ring.map(point => point[1])),
  north: Math.max(...ring.map(point => point[1])),
}));

function inside([x, y]: Point, ring: Ring) {
  let intersects = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [x1, y1] = ring[a];
    const [x2, y2] = ring[b];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) intersects = !intersects;
  }
  return intersects;
}

function southOf96th(point: Point) {
  const [x, y] = point;
  // Approximate the 96th Street line using its west/east taxi-zone boundaries.
  return y < 40.79827 - (x + 73.9764) * 0.48 &&
    manhattanRings.some(({ ring, west, east, south, north }) =>
      x >= west && x <= east && y >= south && y <= north && inside(point, ring));
}

export function congestionCharges(coordinates: Point[]) {
  let south96 = false;
  for (let i = 0; i < coordinates.length; i++) {
    const [x, y] = coordinates[i];
    const [a, b] = coordinates[i - 1] ?? coordinates[i];
    const samples = Math.max(1, Math.ceil(Math.max(Math.abs(x - a), Math.abs(y - b)) / 0.00015));
    for (let j = 1; j <= samples; j++) {
      const point = [a + (x - a) * j / samples, b + (y - b) * j / samples];
      if (reliefZone.some(ring => inside(point, ring))) return { south96: true, south60: true };
      south96 ||= southOf96th(point);
    }
  }
  return { south96, south60: false };
}

const crossings = [
  { name: 'RFK Bridge', pattern: /(?:robert f\.? kennedy|rfk|triboro(?:ugh)?) bridge/i, cents: 746 },
  { name: 'Bronx–Whitestone Bridge', pattern: /(?:bronx[-– ]+)?whitestone bridge/i, cents: 746 },
  { name: 'Throgs Neck Bridge', pattern: /throgs neck bridge/i, cents: 746 },
  { marker: [-73.96472, 40.74556], name: 'Queens Midtown Tunnel', pattern: /(?:queens[-– ]+)?midtown tunnel/i, cents: 746 },
  { marker: [-74.01292, 40.69455], name: 'Hugh L. Carey Tunnel', pattern: /(?:hugh l\.? carey|brooklyn[-– ]+battery) tunnel/i, cents: 746 },
  { name: 'Verrazzano–Narrows Bridge', pattern: /verrazz?ano(?:[-– ]+narrows)? bridge/i, cents: 746, bothWays: true },
  { name: 'Henry Hudson Bridge', pattern: /henry hudson bridge/i, cents: 342 },
  { name: 'Marine Parkway Bridge', pattern: /(?:marine parkway|gil hodges).*bridge/i, cents: 280, bothWays: true },
  { name: 'Cross Bay Bridge', pattern: /cross bay.*bridge/i, cents: 280, bothWays: true },
  { name: 'George Washington Bridge', pattern: /george washington bridge/i, cents: 0 },
  { marker: [-74.0117, 40.7606], name: 'Lincoln Tunnel', pattern: /lincoln tunnel/i, cents: 0 },
  { marker: [-74.0302, 40.7278], name: 'Holland Tunnel', pattern: /holland tunnel/i, cents: 0 },
  { name: 'Goethals Bridge', pattern: /goethals bridge/i, cents: 0 },
  { name: 'Bayonne Bridge', pattern: /bayonne bridge/i, cents: 0 },
  { name: 'Outerbridge Crossing', pattern: /outerbridge crossing/i, cents: 0 },
];

function passesMarker(marker: Point, points: Point[]) {
  return points.some(([x, y], i) => {
    const [a, b] = points[i - 1] ?? points[i];
    const dx = (x - a) * 0.76;
    const dy = y - b;
    const px = (marker[0] - a) * 0.76;
    const py = marker[1] - b;
    const length = dx * dx + dy * dy;
    const fraction = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
    return Math.hypot(px - dx * fraction, py - dy * fraction) < 0.0008;
  });
}

type RoadStep = { name: string; geometry: { coordinates: Point[] } };

export function routeTolls(steps: RoadStep[], hour: number, weekday: boolean, newark: boolean) {
  const seen = new Set<string>();
  const tolls: { label: string; amount: number }[] = [];
  let enteringNewJersey = true;
  const portPeak = weekday ? (hour >= 6 && hour < 10) || (hour >= 16 && hour < 20) : hour >= 11 && hour < 21;
  for (const step of steps) {
    const crossing = crossings.find(item => item.pattern.test(step.name)) ??
      crossings.find(item => item.marker && passesMarker(item.marker, step.geometry.coordinates));
    if (!crossing || seen.has(crossing.name)) continue;
    seen.add(crossing.name);
    if (crossing.cents) {
      tolls.push({ label: crossing.name, amount: crossing.cents * (newark || crossing.bothWays ? 2 : 1) / 100 });
    } else {
      if (!enteringNewJersey || newark) {
        tolls.push({ label: crossing.name + (newark && enteringNewJersey ? ' return toll' : ''), amount: portPeak ? 16.79 : 14.79 });
      }
      enteringNewJersey = !enteringNewJersey;
    }
  }
  return tolls;
}
