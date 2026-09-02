import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const car = traffic.npcVehicles[0];
  const intersection = cityMap.intersections.find((candidate) => candidate.id === 'inter_0_1');
  if (!car || !intersection) throw new Error('Ground-bypass fixture was not created');

  const northLight = cityMap.trafficLights.find(
    (light) => light.intersectionId === intersection.id && light.direction === 'north'
  );
  if (!northLight) throw new Error('Ground-bypass traffic light fixture was not created');
  northLight.state = 'green';

  for (const other of traffic.npcVehicles) {
    if (other !== car) other.health = 0;
  }

  // NPC 0 approaches the selected intersection from the north in its normal
  // southbound lane. The player is deliberately stopped in the conflict zone.
  car.x = intersection.x + 34;
  car.y = intersection.y - 220;
  car.speed = 8;
  const player: VehicleInstance = {
    ...car,
    id: 'ground-bypass-player',
    x: intersection.x,
    y: intersection.y,
    speed: 0,
    isPlayer: true,
    isSiren: false,
    isBraking: true,
  };

  let maxLateralOffset = 0;
  let passedIntersection = false;
  for (let frame = 0; frame < 360; frame += 1) {
    northLight.state = 'green';
    traffic.updateTraffic(DELTA, player);
    maxLateralOffset = Math.max(maxLateralOffset, Math.abs(car.x - (intersection.x + 34)));
    if (car.y > intersection.y + 90) passedIntersection = true;
  }

  if (maxLateralOffset < 60) {
    throw new Error(`NPC never left its blocked lane: max lateral offset ${maxLateralOffset.toFixed(1)}`);
  }
  if (!passedIntersection) {
    throw new Error(`NPC did not pass the blocked intersection: y=${car.y.toFixed(1)}`);
  }

  console.log(
    `FIXED: NPC bypassed a stopped player with ${maxLateralOffset.toFixed(1)}px lateral clearance and rejoined traffic.`
  );
}

main();
