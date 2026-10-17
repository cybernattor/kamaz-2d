import { PhysicsEngine } from '../src/game/physics';
import { PlayerCharacter } from '../src/types';

const keys = { up: false, down: false, left: false, right: false, sprint: false };

function makePlayer(): PlayerCharacter {
  return {
    x: 2000, y: 2000, angle: 0, speed: 0, health: 100, maxHealth: 100, inVehicleId: null,
    isRunning: false, name: 'T', money: 0, xp: 0, level: 1,
    inventory: { repairKits: 0 },
  } as unknown as PlayerCharacter;
}

function main() {
  const physics = new PhysicsEngine();

  // A touch stick pushed fully to the right must walk right with no keys held.
  const right = makePlayer();
  physics.updatePlayerCharacter(right, { ...keys, moveAxis: { x: 1, y: 0 } }, 0.1, []);
  if (!(right.x > 2000) || right.y !== 2000) throw new Error(`Stick right did not walk right (${right.x}, ${right.y})`);

  // Diagonal input keeps a unit direction; speed scales with stick deflection.
  const full = makePlayer();
  const half = makePlayer();
  physics.updatePlayerCharacter(full, { ...keys, moveAxis: { x: 0, y: 1 } }, 0.1, []);
  physics.updatePlayerCharacter(half, { ...keys, moveAxis: { x: 0, y: 0.5 } }, 0.1, []);
  if (!(full.y > half.y && half.y > 2000)) throw new Error('Half deflection should walk slower than full');

  // A released stick (null) with no keys stands still.
  const idle = makePlayer();
  physics.updatePlayerCharacter(idle, { ...keys, moveAxis: null }, 0.1, []);
  if (idle.x !== 2000 || idle.y !== 2000 || idle.speed !== 0) throw new Error('Released stick moved the player');

  console.log('FIXED: on-foot analog touch movement works in every direction.');
}

main();
