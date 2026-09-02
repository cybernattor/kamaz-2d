import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';

const DELTA = 1 / 60;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const car = traffic.npcVehicles[0];
  if (!car) throw new Error('Adaptive-route fixture was not created');

  for (const other of traffic.npcVehicles) {
    if (other !== car) other.health = 0;
  }

  // Southbound NPC on x=634 follows a stopped player on the same lane.
  // The player is deliberately far from the next junction so the NPC must
  // choose a local lateral route instead of using the intersection bypass.
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

  const config = VEHICLE_CONFIGS[car.type];
  const minimumGap = (config.length + VEHICLE_CONFIGS[player.type].length) * 0.5 + 24;
  let closestGap = Infinity;
  let closestFrame = 0;
  let closestPosition = { x: car.x, y: car.y };
  let maxLateralOffset = 0;

  for (let frame = 0; frame < 240; frame += 1) {
    traffic.updateTraffic(DELTA, player);
    const gap = Math.hypot(player.x - car.x, player.y - car.y);
    if (gap < closestGap) {
      closestGap = gap;
      closestFrame = frame;
    closestPosition = { x: car.x, y: car.y };
    }
    maxLateralOffset = Math.max(maxLateralOffset, Math.abs(car.x - 554));
  }

  if (closestGap < minimumGap - 0.5) {
    throw new Error(
      `NPC entered the player's bumper: gap ${closestGap.toFixed(1)} < ${minimumGap.toFixed(1)} ` +
        `at frame ${closestFrame} (${closestPosition.x.toFixed(1)},${closestPosition.y.toFixed(1)})`
    );
  }
  if (maxLateralOffset < 24) {
    throw new Error(
      `NPC never adapted its route on an open straight road: lateral offset ${maxLateralOffset.toFixed(1)}px`
    );
  }

  console.log(
    `FIXED: NPC kept ${closestGap.toFixed(1)}px gap and selected an open lateral route ` +
      `(${maxLateralOffset.toFixed(1)}px offset).`
  );
}

main();
