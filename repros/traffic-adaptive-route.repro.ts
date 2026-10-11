import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';
import { bodyClearance } from './support/bodyClearance';

const DELTA = 1 / 60;

/**
 * A southbound NPC comes up behind a player stopped mid-block, far from the
 * next junction, so it must pass on the open road rather than use the
 * intersection detour. The old waypoint bypass circled a point it could not
 * reach, spun on the spot, and stalled for good beside the player. Checked:
 *  - the bodies never touch (oriented rectangles, not centre distance);
 *  - the NPC actually gets past and back into its lane;
 *  - it steers like a car: no sideways sliding and no turning while stopped.
 */
function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const car = traffic.npcVehicles[0];
  if (!car) throw new Error('Adaptive-route fixture was not created');
  for (const other of traffic.npcVehicles) {
    if (other !== car) other.health = 0;
  }

  car.x = 554;
  car.y = 900;
  car.speed = 10;
  const player: VehicleInstance = {
    ...car,
    id: 'adaptive-route-player',
    x: 554,
    y: 1120,
    speed: 0,
    isPlayer: true,
    isSiren: false,
    isBraking: true,
  };

  let minClearance = Infinity;
  let maxLateralOffset = 0;
  let passedAtFrame = -1;
  let previous = { x: car.x, y: car.y, angle: car.angle };
  // Lights cycle as in the game; a pass can end at a red light mid-merge.
  for (let frame = 0; frame < 1500; frame += 1) {
    cityMap.updateTrafficLights(DELTA);
    traffic.updateTraffic(DELTA, player);
    minClearance = Math.min(minClearance, bodyClearance(car, player));
    if (passedAtFrame < 0) maxLateralOffset = Math.max(maxLateralOffset, Math.abs(car.x - 554));

    // Steering checks cover the pass on the straight; a junction turn later
    // legitimately swaps the axes.
    const lateral = Math.abs(car.x - previous.x);
    const forward = Math.abs(car.y - previous.y);
    if (passedAtFrame < 0 && lateral > forward * 0.5 + 0.05) {
      throw new Error(`NPC slid sideways at frame ${frame}: ${lateral.toFixed(2)} across for ${forward.toFixed(2)} along`);
    }
    const turned = Math.abs(Math.atan2(Math.sin(car.angle - previous.angle), Math.cos(car.angle - previous.angle)));
    if (passedAtFrame < 0 && Math.hypot(car.x - previous.x, car.y - previous.y) < 0.01 && turned > 1e-6) {
      throw new Error(`NPC turned on the spot at frame ${frame}`);
    }
    previous = { x: car.x, y: car.y, angle: car.angle };
    if (passedAtFrame < 0 && car.y - player.y > 60 && Math.abs(car.x - 554) < 1) passedAtFrame = frame;
  }

  if (minClearance < 2) {
    throw new Error(`NPC body touched the player: clearance ${minClearance.toFixed(1)}px`);
  }
  if (maxLateralOffset < 24) {
    throw new Error(`NPC never pulled out to pass on an open road: lateral offset ${maxLateralOffset.toFixed(1)}px`);
  }
  if (passedAtFrame < 0) {
    throw new Error(`NPC never got past the stopped player and back into its lane (at ${car.x.toFixed(1)},${car.y.toFixed(1)})`);
  }

  console.log(
    `FIXED: NPC passed the stopped player and rejoined its lane at frame ${passedAtFrame} ` +
      `(min body clearance ${minClearance.toFixed(1)}px, pull-out ${maxLateralOffset.toFixed(1)}px).`
  );
}

main();
