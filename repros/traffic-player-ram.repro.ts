import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

/**
 * The AI used to keep an NPC clear of the player's bumper unconditionally,
 * teleporting it back to a fixed gap every step regardless of how the gap was
 * closing, so a player reversing into a trailing NPC could never make
 * contact. A later version made the NPC swerve out of the way instead; that
 * was removed on purpose ("Polish map junctions and traffic behavior")
 * because bypassing the player made the NPC fly around them.
 *
 * Intended behavior now: the NPC keeps its lane, does not teleport, and a
 * player ramming it lands a real hit - physics.ts applies pushback and
 * damage. Same fixture geometry as traffic-player-following.repro.ts, except
 * the player drives backward into the NPC behind it.
 */
function buildScene() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  const npc = traffic.npcVehicles[0];
  if (!npc) throw new Error('Ram fixture was not created');
  for (const other of traffic.npcVehicles) {
    if (other !== npc) other.health = 0;
  }

  npc.x = 554;
  npc.y = 760;
  npc.speed = 12;

  // Same position/angle as the working player-following fixture, but
  // reversing (negative speed) straight back into the NPC behind it.
  const player: VehicleInstance = {
    ...npc,
    id: 'ram-fixture-player',
    x: 554,
    y: 1000,
    speed: -22,
    isPlayer: true,
    isSiren: false,
  };

  return { traffic, npc, player };
}

function runSimulation(traffic: TrafficAI, npc: VehicleInstance, player: VehicleInstance, physics: PhysicsEngine) {
  let crashed = false;
  const startX = npc.x;
  for (let frame = 0; frame < 90; frame += 1) {
    traffic.updateTraffic(DELTA, player);
    player.x += Math.cos(player.angle) * player.speed * DELTA;
    player.y += Math.sin(player.angle) * player.speed * DELTA;
    physics.resolveAllCollisions([player, npc], [], [], [], undefined, DELTA, () => {
      crashed = true;
    });
    if (crashed) break;
  }
  return { crashed, lateralOffset: Math.abs(npc.x - startX) };
}

function testHoldsLaneAndTakesTheHit() {
  const { traffic, npc, player } = buildScene();
  const physics = new PhysicsEngine();
  const { crashed, lateralOffset } = runSimulation(traffic, npc, player, physics);

  if (lateralOffset > 2) {
    throw new Error(`NPC swerved around the ramming player: lateral offset ${lateralOffset.toFixed(1)}px`);
  }
  if (!crashed) {
    throw new Error('NPC was never hit - the player still cannot make contact');
  }
  if (npc.health >= 100) {
    throw new Error(`crash callback fired but the NPC took no damage: health ${npc.health}`);
  }
  console.log(
    `FIXED: the NPC held its lane (offset ${lateralOffset.toFixed(1)}px) and took a real hit (health ${npc.health}).`
  );
}

testHoldsLaneAndTakesTheHit();
