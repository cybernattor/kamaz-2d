import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

/**
 * The AI used to keep an NPC clear of the player's bumper unconditionally,
 * teleporting it back to a fixed gap every step regardless of how the gap was
 * closing. That is correct for a fast NPC queueing behind a stopped player
 * (see traffic-player-following.repro.ts) but also dodged a player
 * deliberately reversing into a trailing NPC, so the player could never
 * actually make contact - the NPC kept getting shoved back to the same
 * offset every tick, reading as it "flying" behind the player.
 *
 * Same fixture geometry as traffic-player-following.repro.ts (an NPC ahead
 * of a stopped/slow player it must not rear-end), except the player now
 * drives backward into the NPC. Two outcomes are checked:
 *  - with room to move, the NPC now steers out of the way of the reversing
 *    player (a real driver reacts, rather than either teleporting or
 *    sitting still to be hit);
 *  - with no room to dodge, it takes the hit for real: physics.ts's
 *    collision response applies pushback and damage. startAdaptiveBypass is
 *    stubbed out here rather than boxed in geometrically - the AI's own
 *    "no clearance" behavior is exercised by the existing bypass repros;
 *    this isolates the one thing that changed, that a denied dodge no
 *    longer falls back to the old teleport-away.
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

function testEvadesWithRoom() {
  const { traffic, npc, player } = buildScene();
  const physics = new PhysicsEngine();
  const { crashed, lateralOffset } = runSimulation(traffic, npc, player, physics);

  if (crashed) {
    throw new Error('NPC took the hit instead of using the open road to dodge it');
  }
  if (lateralOffset < 15) {
    throw new Error(`NPC neither dodged nor got hit - it just held still: lateral offset ${lateralOffset.toFixed(1)}px`);
  }
  console.log(`FIXED: with room to move, the NPC steers clear of the player reversing into it (lateral offset ${lateralOffset.toFixed(1)}px).`);
}

function testHitWhenNoRoomToDodge() {
  const { traffic, npc, player } = buildScene();
  const physics = new PhysicsEngine();
  // Force the "nowhere to go" branch deterministically instead of trying to
  // box the NPC in with hand-placed geometry.
  (traffic as unknown as { startAdaptiveBypass: () => boolean }).startAdaptiveBypass = () => false;

  const { crashed } = runSimulation(traffic, npc, player, physics);

  if (!crashed) {
    throw new Error('NPC with no dodge available was never hit - the player still cannot make contact');
  }
  if (npc.health >= 100) {
    throw new Error(`crash callback fired but the NPC took no damage: health ${npc.health}`);
  }
  console.log(`FIXED: with no room to dodge, the NPC still takes a real hit (health ${npc.health}).`);
}

testEvadesWithRoom();
testHitWhenNoRoomToDodge();
