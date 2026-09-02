import { CityMap } from '../src/game/cityMap';
import { PhysicsEngine } from '../src/game/physics';
import { TrafficAI } from '../src/game/trafficAI';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';

const DELTA = 1 / 60;
const INTERSECTION_X = 600;
const INTERSECTION_Y = 1400;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const physics = new PhysicsEngine();

  // Keep the fixture deterministic: use the first southbound and first
  // eastbound cars, disable all unrelated traffic, and force both approaches
  // to see a green light at the same junction.
  const southbound = traffic.npcVehicles[0];
  const eastbound = traffic.npcVehicles[1];
  if (!southbound || !eastbound) throw new Error('Traffic fixture was not created');

  for (const car of traffic.npcVehicles) {
    if (car !== southbound && car !== eastbound) car.health = 0;
  }

  const northLight = cityMap.trafficLights.find(
    (light) => light.intersectionId === 'inter_0_1' && light.direction === 'north'
  );
  const westLight = cityMap.trafficLights.find(
    (light) => light.intersectionId === 'inter_0_1' && light.direction === 'west'
  );
  if (!northLight || !westLight) throw new Error('Traffic light fixture was not created');
  northLight.state = 'green';
  westLight.state = 'green';

  // Their lanes cross at the same point inside the intersection.
  southbound.x = INTERSECTION_X + 34;
  southbound.y = INTERSECTION_Y - 80;
  southbound.speed = 16;
  eastbound.x = INTERSECTION_X - 80;
  eastbound.y = INTERSECTION_Y + 34;
  eastbound.speed = 16;

  const originalRandom = Math.random;
  Math.random = () => 0.99; // Both cars continue straight through the junction.

  try {
    const minAllowedDistance =
      (VEHICLE_CONFIGS[southbound.type].length + VEHICLE_CONFIGS[eastbound.type].length) * 0.38;

    for (let frame = 0; frame < 20; frame += 1) {
      traffic.updateTraffic(DELTA);
      physics.resolveAllCollisions(
        [southbound, eastbound],
        cityMap.destructibles,
        traffic.pedestrians,
        cityMap.buildings,
        undefined,
        DELTA
      );

      const distance = Math.hypot(eastbound.x - southbound.x, eastbound.y - southbound.y);
      if (distance < minAllowedDistance) {
        console.error(
          `REPRODUCED: crossing NPCs overlapped at frame ${frame}; ` +
            `distance ${distance.toFixed(2)} < allowed ${minAllowedDistance.toFixed(2)}.`
        );
        throw new Error('NPC intersection collision was reproduced');
      }
    }

    console.log(`FIXED: crossing NPCs kept at least ${minAllowedDistance.toFixed(2)} distance.`);
  } finally {
    Math.random = originalRandom;
  }
}

main();
