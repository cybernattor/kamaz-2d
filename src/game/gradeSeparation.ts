import type { GradeLevel, GradeZone } from '../types';
import type { RoadPoint, RoadSegment } from './cityMap';

/**
 * Bridges and tunnels as real second levels.
 *
 * A bridge/tunnel road is laid on the map like any other road; only the
 * stretch around each place where it crosses another road is a structure:
 * a ramp climbs (or dips) over GRADE_RAMP px, then the covered stretch runs
 * level across the crossed road and its sidewalks, then a ramp goes back
 * down. The renderer, the physics and traffic all read these structures, so
 * what is drawn on top is also what drives on top.
 *
 * Levels are tracked per entity rather than derived from position alone,
 * because over the covered stretch the same spot is both on the deck and
 * under it. You only get onto a structure along its ramps: a car that enters
 * a ramp from off the structure goes up (or down); over the covered stretch
 * it keeps whatever level it arrived with; off the structure it is on the
 * ground again.
 */

export const GRADE_RAMP = 170;
/** Visual height of a bridge deck, used for its shadow. */
export const GRADE_HEIGHT = 24;
/**
 * Half-length of the covered stretch around a crossing. Every crossing on
 * this map is a full arterial: 110 half-width + 24 sidewalk, plus clear span.
 */
const COVERED_REACH = 174;
/** Railings / tunnel walls sit this far outside the carriageway edge. */
export const GRADE_RAIL_OFFSET = 10;
const SAMPLE_STEP = 16;

export interface GradeSample {
  x: number;
  y: number;
  /** Distance from the start of the road's centerline. */
  s: number;
  tx: number;
  ty: number;
}

export interface GradeStructure {
  kind: 'bridge' | 'tunnel';
  roadId: string;
  width: number;
  /** Centerline samples from `start` to `end` (ramps included). */
  samples: GradeSample[];
  start: number;
  end: number;
  /** Distances along the road of the crossings this structure spans. */
  crossings: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface GradeLocation {
  structure: GradeStructure;
  s: number;
  /** Signed distance from the centerline along `normal`. */
  lateral: number;
  normal: { x: number; y: number };
  /** 0 at the outer end of a ramp, 1 on the covered stretch. */
  lift: number;
}

export interface GradeEntity {
  x: number;
  y: number;
  gradeLevel?: GradeLevel;
  gradeZone?: GradeZone;
}

/** Points every `step` px along a polyline, keeping its corner vertices. */
export const samplePolyline = (points: RoadPoint[], step = SAMPLE_STEP): GradeSample[] => {
  const samples: GradeSample[] = [];
  let travelled = 0;
  let next = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1) continue;
    const tx = (b.x - a.x) / length;
    const ty = (b.y - a.y) / length;
    if (i > 1 && next > travelled + 0.5) samples.push({ x: a.x, y: a.y, s: travelled, tx, ty });
    for (; next < travelled + length; next += step) {
      const along = next - travelled;
      samples.push({ x: a.x + tx * along, y: a.y + ty * along, s: next, tx, ty });
    }
    travelled += length;
  }
  const last = points[points.length - 1];
  const previous = samples[samples.length - 1];
  if (previous) samples.push({ x: last.x, y: last.y, s: travelled, tx: previous.tx, ty: previous.ty });
  return samples;
};

const nearestDistanceAlong = (samples: GradeSample[], point: RoadPoint) =>
  samples.reduce((best, sample) =>
    Math.hypot(sample.x - point.x, sample.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? sample : best).s;

export const buildGradeStructures = (roads: RoadSegment[]): GradeStructure[] => {
  const structures: GradeStructure[] = [];
  roads.forEach((road) => {
    if (road.feature !== 'bridge' && road.feature !== 'tunnel') return;
    if (!road.gradeCrossings?.length) return;
    const samples = samplePolyline(road.points);
    const crossings = road.gradeCrossings.map((point) => nearestDistanceAlong(samples, point)).sort((a, b) => a - b);

    // One span per crossing. Two bridge spans with only a short stretch of
    // ground between their ramps would just be a dip, so they become one
    // viaduct. Tunnels only merge if they actually overlap: a long merged
    // tunnel would hide cars far from any road above, while an open cutting
    // between two short tunnels keeps them in sight.
    const mergeGap = road.feature === 'bridge' ? GRADE_RAMP * 2 : 0;
    const spans: { start: number; end: number; crossings: number[] }[] = [];
    crossings.forEach((at) => {
      const start = at - COVERED_REACH - GRADE_RAMP;
      const end = at + COVERED_REACH + GRADE_RAMP;
      const last = spans[spans.length - 1];
      if (last && start <= last.end + mergeGap) {
        last.end = Math.max(last.end, end);
        last.crossings.push(at);
      } else {
        spans.push({ start, end, crossings: [at] });
      }
    });

    spans.forEach((span) => {
      const spanSamples = samples.filter((sample) => sample.s >= span.start && sample.s <= span.end);
      if (spanSamples.length < 2) return;
      const reach = road.width / 2 + GRADE_RAIL_OFFSET + 40;
      structures.push({
        kind: road.feature === 'bridge' ? 'bridge' : 'tunnel',
        roadId: road.id,
        width: road.width,
        samples: spanSamples,
        start: spanSamples[0].s,
        end: spanSamples[spanSamples.length - 1].s,
        crossings: span.crossings,
        bounds: {
          minX: Math.min(...spanSamples.map((sample) => sample.x)) - reach,
          minY: Math.min(...spanSamples.map((sample) => sample.y)) - reach,
          maxX: Math.max(...spanSamples.map((sample) => sample.x)) + reach,
          maxY: Math.max(...spanSamples.map((sample) => sample.y)) + reach,
        },
      });
    });
  });
  return structures;
};

/** 0 at the outer end of a ramp, rising to 1 where the covered stretch begins. */
export const gradeLift = (structure: GradeStructure, s: number) =>
  Math.max(0, Math.min(1, (s - structure.start) / GRADE_RAMP, (structure.end - s) / GRADE_RAMP));

/**
 * The structure under/over (x, y), if any. `extraReach` widens the footprint
 * sideways, so an entity already on a deck that has been pushed slightly past
 * the railing is still found and can be pushed back.
 */
export const locateOnGradeStructure = (
  structures: GradeStructure[],
  x: number,
  y: number,
  extraReach = 0
): GradeLocation | null => {
  for (const structure of structures) {
    const { bounds } = structure;
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
    let best: GradeLocation | null = null;
    let bestDistance = Infinity;
    let beyondEnd = false;
    const last = structure.samples.length - 1;
    for (let i = 1; i <= last; i++) {
      const a = structure.samples[i - 1];
      const b = structure.samples[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared < 0.25) continue;
      const rawT = ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared;
      const t = Math.max(0, Math.min(1, rawT));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const distance = Math.hypot(x - px, y - py);
      if (distance >= bestDistance) continue;
      const length = Math.sqrt(lengthSquared);
      const normal = { x: -dy / length, y: dx / length };
      const s = a.s + (b.s - a.s) * t;
      bestDistance = distance;
      // Past the first or last sample is off the structure, not on its end.
      beyondEnd = (i === 1 && rawT < 0) || (i === last && rawT > 1);
      best = {
        structure,
        s,
        lateral: (x - px) * normal.x + (y - py) * normal.y,
        normal,
        lift: gradeLift(structure, s),
      };
    }
    if (best && !beyondEnd && Math.abs(best.lateral) <= structure.width / 2 + GRADE_RAIL_OFFSET + 4 + extraReach) return best;
  }
  return null;
};

/**
 * Advances an entity's level for its current position and returns where on
 * a structure it is (null when off every structure).
 */
export const updateGradeLevel = (structures: GradeStructure[], entity: GradeEntity): GradeLocation | null => {
  const previousLevel = entity.gradeLevel ?? 'ground';
  const previousZone = entity.gradeZone ?? 'none';
  const location = locateOnGradeStructure(structures, entity.x, entity.y, previousLevel === 'ground' ? 0 : 40);
  const zone: GradeZone = !location ? 'none' : location.lift >= 1 ? 'covered' : 'ramp';

  let level: GradeLevel = previousLevel;
  if (zone === 'none') level = 'ground';
  else if (zone === 'ramp' && previousZone === 'none') level = location!.structure.kind;
  // A ground-level car at the side of a ramp is not on it either.
  if (level !== 'ground' && location && location.structure.kind !== level) level = 'ground';

  entity.gradeLevel = level;
  entity.gradeZone = zone;
  return location;
};

export interface RailContact {
  /** Speed into the railing or tunnel wall, in vehicle speed units. */
  impactSpeed: number;
  x: number;
  y: number;
}

/**
 * Keeps a vehicle that is up on a bridge (or down in a tunnel) between the
 * railings/walls: anything pushed past them slides back along the rail and
 * loses the part of its speed that went into it.
 */
export const constrainVehicleToGradeStructure = (
  location: GradeLocation | null,
  vehicle: GradeEntity & { angle: number; speed: number },
  halfWidth: number,
  halfLength: number
): RailContact | null => {
  if (!location || (vehicle.gradeLevel ?? 'ground') === 'ground') return null;
  const { normal } = location;
  const forward = { x: Math.cos(vehicle.angle), y: Math.sin(vehicle.angle) };
  // Half the vehicle's extent across the road, for its current heading.
  const across = halfLength * Math.abs(forward.x * normal.x + forward.y * normal.y)
    + halfWidth * Math.abs(-forward.y * normal.x + forward.x * normal.y);
  const limit = location.structure.width / 2 + GRADE_RAIL_OFFSET - 3 - across;
  const excess = Math.abs(location.lateral) - limit;
  if (excess <= 0) return null;

  const side = location.lateral >= 0 ? 1 : -1;
  vehicle.x -= normal.x * side * excess;
  vehicle.y -= normal.y * side * excess;
  location.lateral -= side * excess;

  const vx = forward.x * vehicle.speed;
  const vy = forward.y * vehicle.speed;
  const intoRail = (vx * normal.x + vy * normal.y) * side;
  if (intoRail <= 0) return null;

  // Keep only the speed along the rail, with a little scrape loss.
  const alongX = vx - normal.x * side * intoRail;
  const alongY = vy - normal.y * side * intoRail;
  const alongSpeed = Math.hypot(alongX, alongY);
  if (alongSpeed > 0.05) {
    const direction = vehicle.speed >= 0 ? 1 : -1;
    vehicle.angle = Math.atan2(alongY * direction, alongX * direction);
    vehicle.speed = direction * alongSpeed * 0.9;
  } else {
    vehicle.speed = 0;
  }
  return {
    impactSpeed: intoRail,
    x: vehicle.x + normal.x * side * across,
    y: vehicle.y + normal.y * side * across,
  };
};

/** Keeps a person on foot on a bridge deck / in a tunnel between its walls. */
export const constrainWalkerToGradeStructure = (location: GradeLocation | null, walker: GradeEntity, radius = 8) => {
  if (!location || (walker.gradeLevel ?? 'ground') === 'ground') return;
  const limit = location.structure.width / 2 + GRADE_RAIL_OFFSET - 3 - radius;
  const excess = Math.abs(location.lateral) - limit;
  if (excess <= 0) return;
  const side = location.lateral >= 0 ? 1 : -1;
  walker.x -= location.normal.x * side * excess;
  walker.y -= location.normal.y * side * excess;
};

/** Two entities touch only if they are on the same level. */
export const sameGradeLevel = (a: { gradeLevel?: GradeLevel }, b: { gradeLevel?: GradeLevel }) =>
  (a.gradeLevel ?? 'ground') === (b.gradeLevel ?? 'ground');
