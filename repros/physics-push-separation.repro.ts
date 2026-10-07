import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

/**
 * A stopped NPC used to be forced to 28% of the player's speed on every
 * collision step while the player kept its own speed. The player overtook it
 * again next step, so the NPC stayed glued to the bumper (and was carried
 * along) for seconds and the player never lost speed. Collisions now exchange
 * momentum along the contact normal, so the pair separates after the hit.
 */
function hitParkedCar(playerSpeed: number) {
  const traffic = new TrafficAI(new CityMap());
  const npc = traffic.npcVehicles[0];
  if (!npc) throw new Error('fixture NPC missing');
  npc.x = 554;
  npc.y = 760;
  npc.speed = 0;
  const player: VehicleInstance = {
    ...npc,
    id: 'push-fixture-player',
    isPlayer: true,
    isSiren: false,
    x: npc.x - Math.cos(npc.angle) * 200,
    y: npc.y - Math.sin(npc.angle) * 200,
    speed: playerSpeed,
  };
  const physics = new PhysicsEngine();
  let contactFrames = 0;
  for (let frame = 0; frame < 240; frame += 1) {
    for (const v of [player, npc]) {
      v.x += Math.cos(v.angle) * v.speed * 60 * DELTA;
      v.y += Math.sin(v.angle) * v.speed * 60 * DELTA;
    }
    if (frame % 2 === 0) physics.resolveAllCollisions([player, npc], [], [], [], undefined, DELTA * 2);
    if (Math.hypot(npc.x - player.x, npc.y - player.y) < 50) contactFrames += 1;
  }
  return { contactFrames, playerSpeed: player.speed, npcSpeed: npc.speed };
}

for (const speed of [3, 6, 12]) {
  const { contactFrames, playerSpeed, npcSpeed } = hitParkedCar(speed);
  if (contactFrames > 60) {
    throw new Error(`NPC stayed glued to the player at ${speed} m/s: ${contactFrames} frames in contact`);
  }
  if (playerSpeed >= speed * 0.9) {
    throw new Error(`player lost no speed hitting a parked car at ${speed} m/s: ${playerSpeed.toFixed(2)}`);
  }
  if (npcSpeed <= 0) {
    throw new Error(`parked car was not pushed at ${speed} m/s`);
  }
}
console.log('FIXED: a parked NPC is pushed away, the player slows down and the pair separates instead of sticking.');
