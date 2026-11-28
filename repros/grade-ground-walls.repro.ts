import { CityMap } from '../src/game/cityMap';
import {
  constrainGroundToGradeStructures,
  constrainVehicleToGradeStructure,
  GRADE_RAMP,
  GradeStructure,
  updateGradeLevel,
} from '../src/game/gradeSeparation';
import type { GradeLevel, GradeZone } from '../src/types';

const map = new CityMap();
const structures = map.gradeStructures;
const failures: string[] = [];

interface Car { x: number; y: number; angle: number; speed: number; gradeLevel?: GradeLevel; gradeZone?: GradeZone }

const step = (car: Car) => {
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;
  const location = updateGradeLevel(structures, car);
  constrainVehicleToGradeStructure(location, car, 14, 30)
    ?? constrainGroundToGradeStructures(structures, car, 14, 30);
};

const sampleAt = (structure: GradeStructure, s: number) =>
  structure.samples.reduce((best, sample) => (Math.abs(sample.s - s) < Math.abs(best.s - s) ? sample : best));

for (const structure of structures) {
  const name = `${structure.kind} ${structure.roadId}`;
  const half = structure.width / 2;

  // 1. From the side into the raised part of a ramp: blocked, stays on the ground.
  const mid = sampleAt(structure, structure.start + GRADE_RAMP * 0.75);
  const nx = -mid.ty;
  const ny = mid.tx;
  const side: Car = { x: mid.x + nx * (half + 80), y: mid.y + ny * (half + 80), angle: Math.atan2(-ny, -nx), speed: 6 };
  for (let i = 0; i < 80; i++) step(side);
  if ((side.gradeLevel ?? 'ground') !== 'ground') failures.push(`${name}: a car hitting the ramp side ended up on level ${side.gradeLevel}`);
  const lateral = (side.x - mid.x) * nx + (side.y - mid.y) * ny;
  if (lateral < half) failures.push(`${name}: a car hitting the ramp side got through to lateral ${lateral.toFixed(0)}`);

  // 2. From under the covered stretch along the road toward a ramp: blocked by the abutment.
  const under = sampleAt(structure, structure.start + GRADE_RAMP + 60);
  const fromBelow: Car = { x: under.x, y: under.y, angle: Math.atan2(-under.ty, -under.tx), speed: 6, gradeLevel: 'ground', gradeZone: 'covered' };
  for (let i = 0; i < 80; i++) step(fromBelow);
  const travelled = (fromBelow.x - under.x) * -under.tx + (fromBelow.y - under.y) * -under.ty;
  if (travelled > 60 + 1 && (fromBelow.gradeLevel ?? 'ground') === 'ground') {
    const left = Math.hypot(fromBelow.x - under.x, fromBelow.y - under.y);
    if (left > 120) failures.push(`${name}: a car from under the deck drove ${left.toFixed(0)}px out along the ramp`);
  }

  // 3. Along the road onto the ramp's outer end: still climbs as before.
  const before = structure.samples[0];
  const normal: Car = { x: before.x - before.tx * 60, y: before.y - before.ty * 60, angle: Math.atan2(before.ty, before.tx), speed: 6 };
  let reached: GradeLevel = 'ground';
  for (let i = 0; i < 60; i++) {
    step(normal);
    if (normal.gradeZone === 'covered') { reached = normal.gradeLevel ?? 'ground'; break; }
  }
  if (reached !== structure.kind) failures.push(`${name}: driving up the ramp from its end reached the covered stretch on level ${reached}`);
}

if (failures.length) {
  console.error(`BROKEN:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`FIXED: ${structures.length} structures: ramp sides and abutments are walls from the ground, ramps still climb from their ends.`);
