import { CityMap, RoadPoint, RoadSegment } from '../src/game/cityMap';

/**
 * Roads meet other roads at junctions; they do not run on top of one another.
 * The ring used to lie along an avenue's north stub, the airport ramp along
 * Grand Boulevard's curb, and the south ring left its corner junctions
 * diagonally through the box.
 */
const map = new CityMap();
const failures: string[] = [];
const road = (id: string) => map.roads.find((candidate) => candidate.id === id)!;

const nearestOnPolyline = (point: RoadPoint, line: RoadPoint[]) => {
  let best = { distance: Infinity, tx: 1, ty: 0 };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length)));
    const distance = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
    if (distance < best.distance) best = { distance, tx: dx / length, ty: dy / length };
  }
  return best;
};

const samples = (line: RoadPoint[], step = 10) => {
  const out: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.5) continue;
    for (let d = 0; d < length; d += step) {
      out.push({ x: a.x + ((b.x - a.x) * d) / length, y: a.y + ((b.y - a.y) * d) / length, tx: (b.x - a.x) / length, ty: (b.y - a.y) / length });
    }
  }
  return out;
};

// 1. No road runs along inside another road's carriageway. Two driveways
// that overlap only under a wider road's asphalt (both run across the
// boulevard to its far curb) are covered by it and do not count.
const hiddenUnderWider = (point: RoadPoint, a: RoadSegment, b: RoadSegment) => map.roads.some((wider) =>
  wider.width > Math.max(a.width, b.width) && nearestOnPolyline(point, wider.points).distance < wider.width / 2);
const longestParallelRun = (a: RoadSegment, b: RoadSegment) => {
  let run = 0;
  let longest = 0;
  for (const sample of samples(a.points)) {
    const near = nearestOnPolyline(sample, b.points);
    const parallel = Math.abs(sample.tx * near.tx + sample.ty * near.ty) > 0.9;
    run = near.distance < b.width / 2 - 10 && parallel && !hiddenUnderWider(sample, a, b) ? run + 10 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
};
for (const a of map.roads) {
  for (const b of map.roads) {
    if (a === b) continue;
    const run = longestParallelRun(a, b);
    if (run > 150) failures.push(`${a.id} runs ${run}px along inside ${b.id}`);
  }
}

// 2. The south ring meets the outer avenues at right-angled T-junctions,
// clear of the signalled junctions.
const ring = road('road-ring-south');
for (const [end, next] of [[ring.points[0], ring.points[1]], [ring.points[ring.points.length - 1], ring.points[ring.points.length - 2]]]) {
  if (Math.abs(end.y - next.y) > 1) failures.push(`road-ring-south does not leave its avenue at a right angle at (${end.x}, ${end.y})`);
  const box = map.intersections.find((inter) => Math.hypot(inter.x - end.x, inter.y - end.y) < inter.size / 2 + 150);
  if (box) failures.push(`road-ring-south ends at ${box.id} instead of its own T-junction`);
}

// 3. The airport slip road's two carriageways stay apart everywhere they are
// not hidden under an avenue.
const ramp = road('road-airport-ramp');
const exit = road('road-airport-exit');
const underArterial = (point: RoadPoint) => map.roads.some((candidate) => candidate.roadClass === 'arterial'
  && nearestOnPolyline(point, candidate.points).distance < candidate.width / 2);
const closest = samples(ramp.points)
  .filter((sample) => !underArterial(sample))
  .reduce((best, sample) => Math.min(best, nearestOnPolyline(sample, exit.points).distance), Infinity);
if (closest < ramp.width) failures.push(`airport ramp and exit carriageways overlap (${closest.toFixed(1)}px apart, need ${ramp.width})`);

if (failures.length > 0) {
  throw new Error(`MAP_ROAD_JOINTS_FAILED\n${failures.join('\n')}`);
}
console.log('MAP_ROAD_JOINTS_OK');
