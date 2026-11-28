import { CityMap, RoadPoint } from '../src/game/cityMap';
import {
  constrainVehicleToGradeStructure,
  GradeEntity,
  locateOnGradeStructure,
  samplePolyline,
  updateGradeLevel,
} from '../src/game/gradeSeparation';
import { PhysicsEngine } from '../src/game/physics';
import type { VehicleInstance } from '../src/types';

const map = new CityMap();
const failures: string[] = [];
const structures = map.gradeStructures;

const bridges = structures.filter((structure) => structure.kind === 'bridge');
const tunnels = structures.filter((structure) => structure.kind === 'tunnel');
if (bridges.length === 0) failures.push('no bridge deck was built');
if (tunnels.length === 0) failures.push('no covered tunnel stretch was built');

// A bridge must actually pass over a road: the inner avenues run under it.
for (const x of [1320, 2200]) {
  const under = locateOnGradeStructure(structures, x, 190);
  if (!under || under.structure.kind !== 'bridge' || under.lift < 1) {
    failures.push(`avenue x=${x} is not under the covered part of the bridge`);
  }
}

// The ground road just before a ramp is not part of the structure.
for (const structure of structures) {
  const first = structure.samples[0];
  const lastSample = structure.samples[structure.samples.length - 1];
  for (const [end, sign] of [[first, -1], [lastSample, 1]] as const) {
    if (locateOnGradeStructure(structures, end.x + end.tx * 60 * sign, end.y + end.ty * 60 * sign)) {
      failures.push(`${structure.roadId}: the road 60px past the end of a ramp counts as on the structure`);
    }
  }
}

/** Drives an entity along a path and records the level at each step. */
const drive = (path: RoadPoint[], entity: GradeEntity = { x: path[0].x, y: path[0].y }) => {
  const levels: { x: number; y: number; level: string; lift: number }[] = [];
  for (const point of samplePolyline(path, 8)) {
    entity.x = point.x;
    entity.y = point.y;
    const location = updateGradeLevel(structures, entity);
    levels.push({ x: point.x, y: point.y, level: entity.gradeLevel ?? 'ground', lift: location?.lift ?? 0 });
  }
  return levels;
};

// 1. Along the ring road: up the ramp, over both avenues, down again.
const ring = map.roads.find((road) => road.id === 'road-ring-north')!;
const alongRing = drive(ring.points);
const overAvenue = alongRing.filter((step) => Math.abs(step.x - 1320) < 20 || Math.abs(step.x - 2200) < 20).filter((step) => Math.abs(step.y - 190) < 5);
if (overAvenue.length === 0 || overAvenue.some((step) => step.level !== 'bridge')) {
  failures.push('a car following the ring road is not on the bridge where it crosses the avenues');
}
if (alongRing[0].level !== 'ground' || alongRing[alongRing.length - 1].level !== 'ground') {
  failures.push('the ring road does not start and end at ground level');
}

// 2. Along an avenue: straight under the bridge, never on it.
const underRun = drive([{ x: 1320, y: 620 }, { x: 1320, y: 100 }]);
if (underRun.some((step) => step.level !== 'ground')) {
  failures.push('a car driving up the avenue was lifted onto the bridge it passes under');
}

// 3. Through the southern tunnel and over it.
const ringSouth = map.roads.find((road) => road.id === 'road-ring-south')!;
const throughTunnel = drive(ringSouth.points);
if (!throughTunnel.some((step) => step.level === 'tunnel' && step.lift >= 1)) {
  failures.push('a car following the southern ring never went down into the tunnel');
}
const tunnelCrossing = tunnels[0]?.crossings[0];
const tunnelPoint = tunnels[0]?.samples.reduce((best, sample) =>
  Math.abs(sample.s - (tunnelCrossing ?? 0)) < Math.abs(best.s - (tunnelCrossing ?? 0)) ? sample : best);
if (tunnelPoint) {
  const overRun = drive([{ x: tunnelPoint.x, y: tunnelPoint.y - 500 }, { x: tunnelPoint.x, y: tunnelPoint.y + 500 }]);
  if (overRun.some((step) => step.level !== 'ground')) failures.push('a car driving over the tunnel dropped into it');
}

// 4. Physics: a car on the deck and a car on the avenue below never collide.
const makeVehicle = (id: string, x: number, y: number, angle: number, speed: number, isPlayer: boolean): VehicleInstance => ({
  id, type: 'kamaz_flatbed', x, y, angle, speed, steeringAngle: 0, angularVelocity: 0, color: '#fff',
  health: 100, maxHealth: 100, headlights: 0, turnSignal: 'none', isBraking: false, isReversing: false,
  isHonking: false, isSiren: false, isPlayer, smokeTimer: 0,
});
const physics = new PhysicsEngine();
const onDeck = makeVehicle('deck', 1320, 190, 0, 8, true);
onDeck.gradeLevel = 'bridge';
onDeck.gradeZone = 'covered';
const below = makeVehicle('below', 1320, 190, -Math.PI / 2, 6, false);
physics.resolveAllCollisions([onDeck, below], [], [], [], undefined, 1 / 30);
physics.resolveAllCollisions([onDeck, below], [], [], [], undefined, 1 / 30);
if (onDeck.health < 100 || below.health < 100 || onDeck.x !== 1320 || below.y !== 190) {
  failures.push('a car on the bridge collided with the car passing under it');
}
const sameLevel = makeVehicle('same', 1320, 190, Math.PI, 6, false);
sameLevel.gradeLevel = 'bridge';
const deckPeer = makeVehicle('deck-peer', 1330, 190, 0, 8, true);
deckPeer.gradeLevel = 'bridge';
physics.resolveAllCollisions([deckPeer, sameLevel], [], [], [], undefined, 1 / 30);
if (deckPeer.x === 1330 && sameLevel.x === 1320) failures.push('two cars on the same deck passed through each other');

// 5. Railings keep a car on the deck.
const railCar = makeVehicle('rail', 1700, 190 + 110, Math.PI / 2, 6, true);
railCar.gradeLevel = 'bridge';
railCar.gradeZone = 'covered';
const railLocation = updateGradeLevel(structures, railCar);
const contact = constrainVehicleToGradeStructure(railLocation, railCar, 18, 40);
if (!contact || railCar.y > 190 + 110 + 10 - 18 || railCar.gradeLevel !== 'bridge') {
  failures.push(`the railing did not stop a car driving off the side of the deck (y=${railCar.y.toFixed(1)}, level=${railCar.gradeLevel})`);
}
if (Math.abs(railCar.speed) >= 6) failures.push('hitting the railing cost no speed');

if (failures.length) throw new Error(`GRADE_SEPARATION_FAILED\n${failures.join('\n')}`);
console.log(`FIXED: ${bridges.length} bridge deck(s) and ${tunnels.length} tunnel(s) are real levels: ring traffic goes over/under the avenues, avenue traffic stays on the ground, levels never collide, railings hold.`);
