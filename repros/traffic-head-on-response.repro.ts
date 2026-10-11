import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

/**
 * A player driving head-on at an NPC in its lane. The NPC used to swerve to
 * its right; that was removed on purpose ("Polish map junctions and traffic
 * behavior") because steering around the player made NPCs orbit the player's
 * car. The intended response is now: hold the lane, brake hard for as long
 * as the threat is ahead, and leave any contact to physics. This repro runs
 * TrafficAI alone (no physics), so the cars pass through each other; only
 * the NPC's own response is checked.
 */
function main() {
  const traffic = new TrafficAI(new CityMap());
  const npc = traffic.npcVehicles[0];
  if (!npc) throw new Error('Head-on fixture was not created');
  for (const other of traffic.npcVehicles) if (other !== npc) other.health = 0;

  npc.x = 554;
  npc.y = 760;
  npc.angle = Math.PI / 2;
  npc.speed = 12;
  const player: VehicleInstance = {
    ...npc,
    id: 'head-on-player',
    x: 554,
    y: 980,
    angle: -Math.PI / 2,
    speed: 14,
    isPlayer: true,
    isSiren: false,
  };

  const startX = npc.x;
  const startSpeed = npc.speed;
  let maxLateralOffset = 0;
  let threatFrames = 0;
  let speedAfterThreat = npc.speed;
  for (let frame = 0; frame < 36; frame += 1) {
    const playerAhead = player.y - npc.y > 0;
    const speedBefore = npc.speed;
    traffic.updateTraffic(DELTA, player);
    maxLateralOffset = Math.max(maxLateralOffset, Math.abs(npc.x - startX));
    if (playerAhead) {
      threatFrames += 1;
      if (npc.speed > speedBefore + 1e-6) {
        throw new Error(`NPC accelerated toward a head-on player at frame ${frame}: ${speedBefore.toFixed(2)} -> ${npc.speed.toFixed(2)}`);
      }
      if (!npc.isBraking) throw new Error(`NPC was not braking for a head-on player at frame ${frame}`);
      speedAfterThreat = npc.speed;
    }
    player.x += Math.cos(player.angle) * player.speed * 60 * DELTA;
    player.y += Math.sin(player.angle) * player.speed * 60 * DELTA;
  }

  if (threatFrames < 3) throw new Error(`Fixture broken: player was ahead for only ${threatFrames} frames`);
  if (maxLateralOffset > 2) {
    throw new Error(`NPC left its lane instead of braking: lateral offset ${maxLateralOffset.toFixed(1)}px`);
  }

  console.log(
    `traffic-head-on-response: OK - NPC held its lane (offset ${maxLateralOffset.toFixed(1)}px) and braked ` +
      `for ${threatFrames} threat frames (speed ${startSpeed.toFixed(1)} -> ${speedAfterThreat.toFixed(1)}).`
  );
}

main();
