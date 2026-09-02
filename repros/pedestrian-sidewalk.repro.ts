import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';

const DELTA = 1 / 60;
const GRID = [600, 1400, 2200, 3000];

function nearestRoadDistance(x: number, y: number) {
  return Math.min(...GRID.map((roadX) => Math.abs(x - roadX)), ...GRID.map((roadY) => Math.abs(y - roadY)));
}

function main() {
  const traffic = new TrafficAI(new CityMap());
  for (let frame = 0; frame < 900; frame += 1) {
    traffic.updatePedestrians(DELTA, 120, 120, false);
  }

  const closestToRoad = Math.min(...traffic.pedestrians.map((ped) => nearestRoadDistance(ped.x, ped.y)));
  if (closestToRoad < 95) {
    throw new Error(`Pedestrian entered the roadway: nearest road distance ${closestToRoad.toFixed(1)}`);
  }

  console.log(`FIXED: pedestrians stayed on sidewalks; closest road distance ${closestToRoad.toFixed(1)}.`);
}

main();
