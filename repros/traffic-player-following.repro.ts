import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';
import { bodyClearance } from './support/bodyClearance';

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

  let closestGap = Infinity;
  let maxLateralOffset = 0;
  for (let frame = 0; frame < 180; frame += 1) {
    traffic.updateTraffic(DELTA, player);
    // Body clearance, not centre distance: passing alongside is fine.
    closestGap = Math.min(closestGap, bodyClearance(car, player));
      maxLateralOffset = Math.max(maxLateralOffset, Math.abs(car.x - 554));
  }

  if (closestGap < 2) {
    throw new Error(`NPC body touched the stopped player: clearance ${closestGap.toFixed(1)}px`);
  }
  if (car.speed > 0.8 && maxLateralOffset < 24) {
    throw new Error(`NPC neither stopped nor adapted its route: speed ${car.speed.toFixed(1)}`);
  }

  console.log(
    `FIXED: NPC followed or safely bypassed a stopped player; closest body clearance ${closestGap.toFixed(1)}px, ` +
      `lateral offset ${maxLateralOffset.toFixed(1)}px.`
  );
}

main();
