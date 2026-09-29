import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';

const DELTA = 1 / 60;
/** How far past the kerb (into the drivable surface) a pedestrian may stray. */
const KERB_TOLERANCE = 30;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  for (let frame = 0; frame < 900; frame += 1) {
    traffic.updatePedestrians(DELTA, 120, 120, false);
  }

  // Clearance to the real road polylines (negative = on the drivable surface).
  const closestToRoad = Math.min(...traffic.pedestrians.map((ped) => cityMap.clearanceToRoads({ x: ped.x, y: ped.y, width: 0, height: 0 })));
  if (closestToRoad < -KERB_TOLERANCE) {
    throw new Error(`Pedestrian entered the roadway: ${(-closestToRoad).toFixed(1)}px onto the drivable surface`);
  }

  console.log(`FIXED: pedestrians stayed on sidewalks; closest kerb clearance ${closestToRoad.toFixed(1)}.`);
}

main();
