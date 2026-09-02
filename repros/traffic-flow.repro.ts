import { CityMap } from '../src/game/cityMap';
import { PhysicsEngine } from '../src/game/physics';
import { TrafficAI } from '../src/game/trafficAI';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';

const DELTA = 1 / 60;
const SIMULATION_SECONDS = 60;
const GRID = [600, 1400, 2200, 3000];

function nearestRoadDistance(x: number, y: number) {
  return Math.min(...GRID.map((roadX) => Math.abs(x - roadX)), ...GRID.map((roadY) => Math.abs(y - roadY)));
}

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
    physics.resolveAllCollisions(traffic.npcVehicles, cityMap.destructibles, traffic.pedestrians, cityMap.buildings, undefined, DELTA);

    for (const car of traffic.npcVehicles) {
      const previous = previousPositions.get(car.id);
      const isStationary = previous && Math.hypot(car.x - previous.x, car.y - previous.y) < 0.1;
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
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const aiData = (traffic as unknown as { aiData: Map<string, { roadType: string; roadCoord: number; direction: string; isTurning: boolean }> }).aiData;
        const firstAi = aiData.get(first.id);
        const secondAi = aiData.get(second.id);
        const sameRoadOppositeLane = Boolean(
          firstAi && secondAi &&
            !firstAi.isTurning && !secondAi.isTurning &&
            firstAi.roadType === secondAi.roadType &&
            firstAi.roadCoord === secondAi.roadCoord &&
            firstAi.direction !== secondAi.direction
        );
        const sameHeading = Boolean(
          firstAi && secondAi && !firstAi.isTurning && !secondAi.isTurning &&
            firstAi.direction === secondAi.direction &&
            firstAi.roadType === secondAi.roadType && firstAi.roadCoord === secondAi.roadCoord
        );
        const allowedDistance = sameRoadOppositeLane
          ? (firstConfig.width + secondConfig.width) / 2 + 6
          : sameHeading
          ? (firstConfig.length + secondConfig.length) / 2 + 8
          : Math.hypot(firstConfig.length / 2, firstConfig.width / 2) +
            Math.hypot(secondConfig.length / 2, secondConfig.width / 2) + 2;
        const clearance = distance - allowedDistance;
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
  const offRoadCount = traffic.npcVehicles.filter((car) => nearestRoadDistance(car.x, car.y) > 110).length;
  const maxStationarySeconds = Math.max(...maxStationaryFrames.values()) * DELTA;
  const maxSpeed = Math.max(...traffic.npcVehicles.map((car) => car.speed));
  const [maxStationaryCarId, maxStationaryFrameCount] = [...maxStationaryFrames.entries()].sort((a, b) => b[1] - a[1])[0];
  const maxStationaryCar = traffic.npcVehicles.find((car) => car.id === maxStationaryCarId);

  if (damagedNpcCount > 0) throw new Error(`NPC traffic took damage during the simulation: ${damagedNpcCount}`);
  if (offRoadCount > 0) throw new Error(`NPC traffic left the road grid: ${offRoadCount}`);
  if (minNpcClearance < 0) {
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
