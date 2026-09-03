import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 30;

/**
 * The AI kept an NPC clear of the player's bumper unconditionally, teleporting
 * it back to a fixed gap every step regardless of how the gap was closing.
 * That is correct for a fast NPC queueing behind a stopped player (see
 * traffic-player-following.repro.ts) but also dodged a player deliberately
 * driving into a stationary NPC, so the player could never actually hit one -
 * it just kept getting shoved away, "flying" ahead of the car at a fixed
 * offset. A hard approach must land on physics.ts's real collision instead.
 */
function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const physics = new PhysicsEngine();

  const npc = traffic.npcVehicles[0];
  if (!npc) throw new Error('Ram fixture was not created');
  for (const other of traffic.npcVehicles) {
    if (other !== npc) other.health = 0;
  }

  npc.x = 554;
  npc.y = 1000;
  npc.speed = 0;
  npc.angle = -Math.PI / 2;

  const player: VehicleInstance = {
    ...npc,
    id: 'ram-fixture-player',
    x: 554,
    y: 1300,
    speed: 20,
    isPlayer: true,
    isSiren: false,
  };

  let crashed = false;
  let closestGap = Infinity;

  for (let frame = 0; frame < 90; frame += 1) {
    traffic.updateTraffic(DELTA, player);
    player.x += Math.cos(player.angle) * player.speed * DELTA;
    player.y += Math.sin(player.angle) * player.speed * DELTA;
    physics.resolveAllCollisions([player, npc], [], [], [], undefined, DELTA, () => {
      crashed = true;
    });
    closestGap = Math.min(closestGap, Math.hypot(player.x - npc.x, player.y - npc.y));
    if (crashed) break;
  }

  if (!crashed) {
    throw new Error(
      `player never made contact with a stationary NPC ahead of it; closest gap ${closestGap.toFixed(1)}px`
    );
  }
  if (npc.health >= 100) {
    throw new Error(`crash callback fired but the NPC took no damage: health ${npc.health}`);
  }

  console.log(`FIXED: a fast player closing on a stationary NPC lands a real hit (NPC health ${npc.health}).`);
}

main();
