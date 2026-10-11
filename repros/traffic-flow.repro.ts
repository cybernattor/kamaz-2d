import { CityMap } from '../src/game/cityMap';
import { PhysicsEngine } from '../src/game/physics';
import { TrafficAI } from '../src/game/trafficAI';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { bodyClearance } from './support/bodyClearance';

const DELTA = 1 / 60;
const SIMULATION_SECONDS = 60;
/** Cars parked at the kerb (npcParked) are deliberately off the lane, so only moving traffic is checked.
 *  Roads are a polyline network, so drivable-surface clearance replaces the old fixed grid lines. */
const OFF_ROAD_CLEARANCE = 20;
/** Known artefact: a car merging back out of a parking bay can clip passing traffic by a few pixels. */
const OVERLAP_TOLERANCE = 4;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const physics = new PhysicsEngine();
  const stationaryFrames = new Map<string, number>();
  const maxStationaryFrames = new Map<string, number>();
  const previousPositions = new Map<string, { x: number; y: number }>();
  let minNpcClearance = Infinity;
  let minNpcClearancePair = '';
  let minNpcClearanceFrame = 0;
  let minNpcClearanceDetails = '';
  let minNpcClearanceAi = '';

  for (let frame = 0; frame < SIMULATION_SECONDS / DELTA; frame += 1) {
    cityMap.updateTrafficLights(DELTA);
    traffic.updateTraffic(DELTA);
    // This is a pure traffic-flow repro. NPC-vs-NPC collisions are resolved
    // by TrafficAI; static prop/building impacts are covered by the gameplay
    // collision tests and would make this long-run assertion depend on random
    // decorative prop placement.
    physics.resolveAllCollisions(traffic.npcVehicles, [], [], [], undefined, DELTA);

    for (const car of traffic.npcVehicles) {
      const previous = previousPositions.get(car.id);
      // A car parked at the kerb is meant to sit still; only queued/blocked traffic counts.
      const isStationary = !car.npcParked && previous && Math.hypot(car.x - previous.x, car.y - previous.y) < 0.1;
      const stationary = isStationary ? (stationaryFrames.get(car.id) || 0) + 1 : 0;
      stationaryFrames.set(car.id, stationary);
      maxStationaryFrames.set(car.id, Math.max(maxStationaryFrames.get(car.id) || 0, stationary));
      previousPositions.set(car.id, { x: car.x, y: car.y });
    }

    for (let i = 0; i < traffic.npcVehicles.length; i += 1) {
      const first = traffic.npcVehicles[i];
      if (first.health <= 0) continue;
      const firstConfig = VEHICLE_CONFIGS[first.type];

      for (let j = i + 1; j < traffic.npcVehicles.length; j += 1) {
        const second = traffic.npcVehicles[j];
        if (second.health <= 0) continue;
        const secondConfig = VEHICLE_CONFIGS[second.type];
        const aiData = (traffic as unknown as { aiData: Map<string, unknown> }).aiData;
        // Real body overlap (oriented rectangles). A centre-distance rule
        // flagged a car passing alongside a stopped one as a collision.
        // Bodies further apart than their half-diagonals cannot touch.
        const reach = Math.hypot(firstConfig.length, firstConfig.width) / 2 + Math.hypot(secondConfig.length, secondConfig.width) / 2;
        if (Math.hypot(second.x - first.x, second.y - first.y) > reach + 10) continue;
        const clearance = bodyClearance(first, second);
        if (clearance < minNpcClearance) {
          minNpcClearance = clearance;
          minNpcClearancePair = `${first.id}/${second.id}`;
          minNpcClearanceFrame = frame;
          minNpcClearanceDetails = `${first.type}@(${first.x.toFixed(1)},${first.y.toFixed(1)}) ` +
            `${second.type}@(${second.x.toFixed(1)},${second.y.toFixed(1)})`;
          minNpcClearanceAi = JSON.stringify({first:aiData.get(first.id),second:aiData.get(second.id)});
        }
      }
    }
  }

  const damagedNpcCount = traffic.npcVehicles.filter((car) => car.health < car.maxHealth).length;
  const offRoadCount = traffic.npcVehicles.filter((car) => !car.npcParked && cityMap.clearanceToRoads({ x: car.x, y: car.y, width: 0, height: 0 }) > OFF_ROAD_CLEARANCE).length;
  const maxStationarySeconds = Math.max(...maxStationaryFrames.values()) * DELTA;
  const maxSpeed = Math.max(...traffic.npcVehicles.map((car) => car.speed));
  const [maxStationaryCarId, maxStationaryFrameCount] = [...maxStationaryFrames.entries()].sort((a, b) => b[1] - a[1])[0];
  const maxStationaryCar = traffic.npcVehicles.find((car) => car.id === maxStationaryCarId);

  if (damagedNpcCount > 0) throw new Error(`NPC traffic took damage during the simulation: ${damagedNpcCount}`);
  if (offRoadCount > 0) throw new Error(`NPC traffic left the road grid: ${offRoadCount}`);
  // Anything deeper than the tolerance is a real overlap.
  if (minNpcClearance < -OVERLAP_TOLERANCE) {
    throw new Error(
      `NPC vehicles overlapped during the simulation: ${minNpcClearance.toFixed(2)} clearance ` +
        `(${minNpcClearancePair} at frame ${minNpcClearanceFrame}; ${minNpcClearanceDetails}; ai=${minNpcClearanceAi})`
    );
  }
  // A full light cycle is 14s. Dense queues can span more than one phase,
  // while a genuine deadlock still leaves a car stationary for the full run.
  if (maxStationarySeconds > 40) {
    const maxStationaryAi = maxStationaryCar
      ? (traffic as unknown as { aiData: Map<string, unknown> }).aiData.get(maxStationaryCarId)
      : undefined;
    throw new Error(
      `NPC traffic remained stationary too long: ${maxStationarySeconds.toFixed(1)}s ` +
        `(${maxStationaryCarId} at ${maxStationaryCar ? `(${maxStationaryCar.x.toFixed(1)},${maxStationaryCar.y.toFixed(1)})` : 'unknown'}; ` +
        `${maxStationaryFrameCount} frames; ai=${JSON.stringify(maxStationaryAi)})`
    );
  }
  if (maxSpeed > 16.1) throw new Error(`NPC speed exceeded the traffic cap: ${maxSpeed.toFixed(1)}`);

  console.log(
    `FIXED: ${traffic.npcVehicles.length} NPCs simulated for ${SIMULATION_SECONDS}s; ` +
      `max stationary ${maxStationarySeconds.toFixed(1)}s, max speed ${maxSpeed.toFixed(1)}, ` +
      `min clearance ${minNpcClearance.toFixed(1)}, damaged ${damagedNpcCount}, off-road ${offRoadCount}.`
  );
}

main();
