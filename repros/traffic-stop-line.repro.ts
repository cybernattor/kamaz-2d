import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';

const DELTA = 1 / 60;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const car = traffic.npcVehicles[0];
  if (!car) throw new Error('Traffic fixture was not created');

  for (const other of traffic.npcVehicles) {
    if (other !== car) other.health = 0;
  }

  const intersection = cityMap.intersections.find((candidate) => candidate.id === 'inter_0_1');
  const northLight = cityMap.trafficLights.find(
    (light) => light.intersectionId === intersection?.id && light.direction === 'north'
  );
  if (!intersection || !northLight) throw new Error('Stop-line fixture was not created');

  car.x = intersection.x + 34;
  car.y = intersection.y - 220;
  car.speed = 15;
  northLight.state = 'red';

  const config = VEHICLE_CONFIGS[car.type];
  const stopLine = intersection.y - intersection.size / 2 - config.length / 2 - 8;

  for (let frame = 0; frame < 180; frame += 1) {
    northLight.state = 'red';
    traffic.updateTraffic(DELTA);
    if (car.y > stopLine + 0.01) {
      throw new Error(
        `NPC crossed the stop line at frame ${frame}: y=${car.y.toFixed(2)}, line=${stopLine.toFixed(2)}`
      );
    }
  }

  console.log(`FIXED: NPC stayed behind the stop line at ${stopLine.toFixed(2)}.`);
}

main();
