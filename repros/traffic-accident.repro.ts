import { CityMap } from '../src/game/cityMap';
import { PhysicsEngine } from '../src/game/physics';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const physics = new PhysicsEngine();
  const npc = traffic.npcVehicles[0];
  if (!npc) throw new Error('Traffic fixture was not created');

  const player: VehicleInstance = {
    id: 'repro_player',
    type: 'kamaz_dump',
    x: npc.x - 38,
    y: npc.y,
    angle: 0,
    speed: 12,
    steeringAngle: 0,
    angularVelocity: 0,
    color: '#f97316',
    health: 100,
    maxHealth: 100,
    headlights: 1,
    turnSignal: 'none',
    isBraking: false,
    isReversing: false,
    isHonking: false,
    isSiren: false,
    isPlayer: true,
    smokeTimer: 0,
  };
  npc.x = player.x + 30;
  npc.y = player.y;
  npc.angle = Math.PI;
  npc.speed = 4;

  physics.resolveAllCollisions(
    [player, npc],
    cityMap.destructibles,
    traffic.pedestrians,
    cityMap.buildings,
    undefined,
    1 / 60,
    (event, firstVehicle, secondVehicle) => {
      traffic.handleVehicleCrash(
        firstVehicle,
        secondVehicle,
        event.impactSpeed,
        event.x,
        event.y
      );
    }
  );

  const driver = traffic.pedestrians.find((ped) => ped.vehicleId === npc.id);
  if (!npc.isCrashed || npc.speed !== 0 || !driver?.isDriver || !driver.speechText) {
    throw new Error('NPC accident did not stop the car and release a speaking driver');
  }

  const building = cityMap.buildings[0];
  if (!building) throw new Error('Building fixture was not created');
  const wallVictim: VehicleInstance = {
    ...npc,
    id: 'wall-crash-npc',
    x: building.x,
    y: building.y,
    speed: 8,
    angle: 0,
    health: 100,
    isCrashed: false,
    crashTimer: undefined,
  };
  physics.resolveAllCollisions(
    [wallVictim],
    cityMap.destructibles,
    traffic.pedestrians,
    cityMap.buildings,
    undefined,
    1 / 60,
    (event, firstVehicle, secondVehicle) => {
      traffic.handleVehicleCrash(firstVehicle, secondVehicle, event.impactSpeed, event.x, event.y);
    }
  );
  const wallDriver = traffic.pedestrians.find((ped) => ped.vehicleId === wallVictim.id);
  if (!wallVictim.isCrashed || !wallDriver?.isDriver) {
    throw new Error('NPC driver stayed inside after a serious building crash');
  }

  console.log(`FIXED: vehicle and building crashes release NPC drivers, including: ${driver.speechText}`);
}

main();
