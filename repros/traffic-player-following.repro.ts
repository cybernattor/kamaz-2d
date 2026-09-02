import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';

const DELTA = 1 / 60;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const car = traffic.npcVehicles[0];
  if (!car) throw new Error('Player-following fixture was not created');

  for (const other of traffic.npcVehicles) {
    if (other !== car) other.health = 0;
  }

  car.x = 554;
  car.y = 760;
  car.speed = 12;
  const player: VehicleInstance = {
    ...car,
    id: 'player-following-fixture',
    x: 554,
    y: 1000,
    speed: 0,
    isPlayer: true,
    isSiren: false,
  };

  const minimumGap = (VEHICLE_CONFIGS[car.type].length + VEHICLE_CONFIGS[player.type].length) * 0.5 + 24;
  let closestGap = Infinity;
  let maxLateralOffset = 0;
  for (let frame = 0; frame < 180; frame += 1) {
    traffic.updateTraffic(DELTA, player);
    closestGap = Math.min(closestGap, Math.hypot(player.x - car.x, player.y - car.y));
      maxLateralOffset = Math.max(maxLateralOffset, Math.abs(car.x - 554));
  }

  if (closestGap < minimumGap - 0.5) {
    throw new Error(`NPC entered the player's bumper: gap ${closestGap.toFixed(1)} < ${minimumGap.toFixed(1)}`);
  }
  if (car.speed > 0.8 && maxLateralOffset < 24) {
    throw new Error(`NPC neither stopped nor adapted its route: speed ${car.speed.toFixed(1)}`);
  }

  console.log(
    `FIXED: NPC followed or safely bypassed a stopped player; closest gap ${closestGap.toFixed(1)}px, ` +
      `lateral offset ${maxLateralOffset.toFixed(1)}px.`
  );
}

main();
