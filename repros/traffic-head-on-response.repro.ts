import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { bodyClearance } from './support/bodyClearance';

const DELTA = 1 / 60;

/**
 * A player drives head-on at an NPC in its lane. A real driver stands on the
 * brake and steers for the kerb - once, without changing their mind - then
 * returns to the lane after the threat has passed. The old response re-chose
 * a side every frame (the "orbiting" glitch), so the swerve must also be a
 * single committed move.
 */
function main() {
  const traffic = new TrafficAI(new CityMap());
  const npc = traffic.npcVehicles[0];
  if (!npc) throw new Error('Head-on fixture was not created');
  for (const other of traffic.npcVehicles) if (other !== npc) other.health = 0;

  // Southbound lane of the x=520 arterial: lane centre 554, kerb side east.
  npc.x = 554;
  npc.y = 760;
  npc.angle = Math.PI / 2;
  npc.speed = 12;
  const player: VehicleInstance = {
    ...npc,
    id: 'head-on-player',
    x: 554,
    y: 1100,
    angle: -Math.PI / 2,
    speed: 8,
    isPlayer: true,
    isSiren: false,
  };

  const fullBrakePerFrame = VEHICLE_CONFIGS[npc.type].braking * DELTA;
  let maxKerbOffset = 0;
  let wrongSide = 0;
  let directionChanges = 0;
  let lastLateralSign = 0;
  let minClearance = Infinity;
  let hardBrakeFrames = 0;
  let threatFrames = 0;
  let previousX = npc.x;
  for (let frame = 0; frame < 150; frame += 1) {
    const playerAhead = player.y - npc.y > 0;
    const speedBefore = npc.speed;
    traffic.updateTraffic(DELTA, player);
    if (playerAhead) {
      threatFrames += 1;
      // Full brake pedal: speed falls at the vehicle's full braking rate.
      if (speedBefore - npc.speed >= fullBrakePerFrame * 0.95) hardBrakeFrames += 1;
      const step = npc.x - previousX;
      const sign = Math.abs(step) > 0.02 ? Math.sign(step) : 0;
      if (sign !== 0 && lastLateralSign !== 0 && sign !== lastLateralSign) directionChanges += 1;
      if (sign !== 0) lastLateralSign = sign;
    }
    maxKerbOffset = Math.max(maxKerbOffset, npc.x - 554);
    wrongSide = Math.max(wrongSide, 554 - npc.x);
    minClearance = Math.min(minClearance, bodyClearance(npc, player));
    previousX = npc.x;
    player.x += Math.cos(player.angle) * player.speed * 60 * DELTA;
    player.y += Math.sin(player.angle) * player.speed * 60 * DELTA;
  }

  if (threatFrames < 5) throw new Error(`Fixture broken: player was ahead for only ${threatFrames} frames`);
  if (hardBrakeFrames < threatFrames * 0.6) {
    throw new Error(`NPC did not brake hard for a head-on threat: ${hardBrakeFrames}/${threatFrames} frames at full braking`);
  }
  if (maxKerbOffset < 20) throw new Error(`NPC did not swerve toward the kerb: ${maxKerbOffset.toFixed(1)}px`);
  if (wrongSide > 1) throw new Error(`NPC swerved toward oncoming traffic: ${wrongSide.toFixed(1)}px`);
  if (directionChanges > 0) throw new Error(`NPC changed its mind mid-swerve (${directionChanges} reversals) - the orbiting glitch`);
  if (minClearance < 2) throw new Error(`Swerve did not avoid contact: body clearance ${minClearance.toFixed(1)}px`);
  if (Math.abs(npc.x - 554) > 1) throw new Error(`NPC never returned to its lane after the threat: x=${npc.x.toFixed(1)}`);

  console.log(
    `traffic-head-on-response: OK - braked hard on ${hardBrakeFrames}/${threatFrames} threat frames, swerved ` +
      `${maxKerbOffset.toFixed(1)}px toward the kerb in one move, min clearance ${minClearance.toFixed(1)}px, back in lane.`
  );
}

main();
