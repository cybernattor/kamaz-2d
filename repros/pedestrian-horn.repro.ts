import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';

const DELTA = 1 / 60;

function main() {
  const traffic = new TrafficAI(new CityMap());
  const pedestrian = traffic.pedestrians[0];
  if (!pedestrian) throw new Error('Horn fixture was not created');

  const playerX = 1000;
  const playerY = 1000;
  pedestrian.x = 1040;
  pedestrian.y = 1000;
  pedestrian.targetX = 1040;
  pedestrian.targetY = 1000;

  traffic.updatePedestrians(DELTA, playerX, playerY, false);
  traffic.updatePedestrians(DELTA, playerX, playerY, true);
  const firstTarget = { x: pedestrian.panicTargetX, y: pedestrian.panicTargetY };

  for (let frame = 0; frame < 60; frame += 1) {
    traffic.updatePedestrians(DELTA, playerX, playerY, true);
    if (pedestrian.panicTargetX !== firstTarget.x || pedestrian.panicTargetY !== firstTarget.y) {
      throw new Error('Pedestrian recalculated its escape target while the horn was held');
    }
  }

  if (firstTarget.x === undefined || firstTarget.y === undefined) {
    throw new Error('Pedestrian did not choose a stable escape target');
  }

  console.log('FIXED: held horn caused one stable pedestrian escape route without vibration.');
}

main();
