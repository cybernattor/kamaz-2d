import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

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
  const xSamples: number[] = [];
  for (let frame = 0; frame < 36; frame += 1) {
    traffic.updateTraffic(DELTA, player);
    xSamples.push(npc.x);
    player.x += Math.cos(player.angle) * player.speed * 60 * DELTA;
    player.y += Math.sin(player.angle) * player.speed * 60 * DELTA;
  }

  const lateralOffset = Math.abs(npc.x - startX);
  const directionChanges = xSamples.slice(2).reduce((count, x, index) => {
    const previousDelta = xSamples[index + 1] - xSamples[index];
    const delta = x - xSamples[index + 1];
    return count + (previousDelta * delta < -0.02 ? 1 : 0);
  }, 0);
  if (npc.speed > 1 && lateralOffset < 12) {
    throw new Error(`NPC neither braked nor committed to a right-side escape: speed=${npc.speed.toFixed(1)}, offset=${lateralOffset.toFixed(1)}`);
  }
  if (directionChanges > 1) throw new Error(`NPC oscillated during head-on response (${directionChanges} lateral direction changes)`);

  console.log(`traffic-head-on-response: OK - NPC chose one stable response (offset ${lateralOffset.toFixed(1)}px, speed ${npc.speed.toFixed(1)}).`);
}

main();
