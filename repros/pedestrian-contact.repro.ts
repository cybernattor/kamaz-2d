import { CityMap } from '../src/game/cityMap';
import { PhysicsEngine } from '../src/game/physics';
import { TrafficAI } from '../src/game/trafficAI';

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const physics = new PhysicsEngine();
  const vehicle = traffic.npcVehicles[0];
  const pedestrian = traffic.pedestrians[0];
  if (!vehicle || !pedestrian) throw new Error('Pedestrian fixture was not created');

  vehicle.x = 1000;
  vehicle.y = 1000;
  vehicle.angle = 0;
  vehicle.speed = 8;
  pedestrian.x = vehicle.x;
  pedestrian.y = vehicle.y + 30;
  pedestrian.state = 'walking';
  pedestrian.speechText = undefined;
  pedestrian.speechTimer = 0;

  physics.resolveAllCollisions(
    [vehicle],
    cityMap.destructibles,
    [pedestrian],
    cityMap.buildings,
    undefined,
    1 / 60
  );

  if (String(pedestrian.state) === 'ragdoll' || pedestrian.speechText) {
    throw new Error('Pedestrian reacted without touching the vehicle body');
  }

  vehicle.speed = 0.5;
  pedestrian.x = vehicle.x + 8;
  pedestrian.y = vehicle.y;
  physics.resolveAllCollisions(
    [vehicle],
    cityMap.destructibles,
    [pedestrian],
    cityMap.buildings,
    undefined,
    1 / 60
  );

  if (String(pedestrian.state) !== 'ragdoll' || !pedestrian.speechText || vehicle.speed >= 0.5) {
    throw new Error('Slow vehicle passed through a pedestrian instead of resolving the body contact');
  }

  console.log('FIXED: a slow vehicle resolves a real pedestrian body contact without passing through.');
}

main();
