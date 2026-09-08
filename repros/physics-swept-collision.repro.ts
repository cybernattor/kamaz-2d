import { PhysicsEngine } from '../src/game/physics';

const makeVehicle = (id: string, x: number, speed: number, isPlayer: boolean, type: any = 'sedan') => ({
  id,
  type,
  x,
  y: 0,
  angle: 0,
  speed,
  steeringAngle: 0,
  angularVelocity: 0,
  color: '#fff',
  health: 100,
  maxHealth: 100,
  headlights: 0,
  turnSignal: 'none' as const,
  isBraking: false,
  isReversing: false,
  isHonking: false,
  isSiren: false,
  isPlayer,
  smokeTimer: 0,
});

const physics = new PhysicsEngine();
const player = makeVehicle('player', 0, 190 / 3.6, true, 'sports');
const npc = makeVehicle('npc', 60, 0, false);

// Seed the previous-position history, then move the player across the NPC in
// one 30 Hz step. A final-position-only detector misses this contact.
physics.resolveAllCollisions([player, npc], [], [], [], undefined, 1 / 30);
player.x += player.speed * 60 * (1 / 30);
physics.resolveAllCollisions([player, npc], [], [], [], undefined, 1 / 30);

if (player.health >= 100 || npc.health >= 100) {
  throw new Error('Swept vehicle collision was missed');
}

console.log(`FIXED: swept vehicle collision applied damage (player ${player.health}, npc ${npc.health}).`);

const overlappedPlayer = makeVehicle('overlap-player', 200, 0, true);
const overlappedNpc = makeVehicle('overlap-npc', 200, 0, false);
physics.resolveAllCollisions([overlappedPlayer, overlappedNpc], [], [], [], undefined, 1 / 30);
if (overlappedPlayer.x === overlappedNpc.x && overlappedPlayer.y === overlappedNpc.y) {
  throw new Error('Zero-distance vehicle collision was not separated');
}
console.log('FIXED: zero-distance vehicle contact is separated deterministically.');
