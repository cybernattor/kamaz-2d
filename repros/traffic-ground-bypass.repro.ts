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
  let bypassFrames = 0;
  let bypassTurnRadians = 0;
  let previousBypassAngle: number | undefined;
  for (let frame = 0; frame < 360; frame += 1) {
    northLight.state = 'green';
    traffic.updateTraffic(DELTA, player);
    maxLateralOffset = Math.max(maxLateralOffset, Math.abs(car.x - (intersection.x + 34)));
    if (car.y > intersection.y + 90) passedIntersection = true;

    const ai = (traffic as unknown as { aiData: Map<string, { groundBypass?: unknown }> }).aiData.get(car.id);
    if (ai?.groundBypass) {
      bypassFrames += 1;
      const reservations = (traffic as unknown as {
        intersectionReservations: Map<string, string>;
      }).intersectionReservations;
      if (reservations.get(intersection.id) === car.id) {
        throw new Error('NPC kept the intersection reservation after starting its bypass');
      }
      if (previousBypassAngle !== undefined) {
        const angleDelta = Math.atan2(
          Math.sin(car.angle - previousBypassAngle),
          Math.cos(car.angle - previousBypassAngle)
        );
        bypassTurnRadians += Math.abs(angleDelta);
      }
      previousBypassAngle = car.angle;
    }
  }

  if (bypassFrames === 0) throw new Error('NPC never entered the ground-bypass mode');
  if (bypassFrames > 240) {
    throw new Error(`NPC stayed in the bypass too long: ${bypassFrames} frames`);
  }
  if (bypassTurnRadians > 18) {
    throw new Error(`NPC orbited the bypass route: ${bypassTurnRadians.toFixed(1)} radians of turning`);
  }
  if (maxLateralOffset < 60) {
    throw new Error(`NPC never left its blocked lane: max lateral offset ${maxLateralOffset.toFixed(1)}`);
  }
  if (!passedIntersection) {
    throw new Error(`NPC did not pass the blocked intersection: y=${car.y.toFixed(1)}`);
  }

  console.log(
    `FIXED: NPC bypassed a stopped player with ${maxLateralOffset.toFixed(1)}px lateral clearance, ` +
      `completed in ${bypassFrames} frames and turned ${bypassTurnRadians.toFixed(1)} radians.`
  );
}

main();
