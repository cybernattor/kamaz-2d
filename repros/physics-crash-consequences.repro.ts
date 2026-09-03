import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 30;

/**
 * A hard vehicle-vehicle or vehicle-building impact used to just apply
 * damage and a straight-line push - no spin, and the player could floor the
 * throttle again the instant after a T-bone as if nothing happened. Real
 * off-center hits impart rotation, and a driver needs a moment to recover
 * control after a serious hit.
 */
function makeVehicle(overrides: Partial<VehicleInstance>): VehicleInstance {
  return {
    id: 'v',
    type: 'sedan',
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    steeringAngle: 0,
    angularVelocity: 0,
    color: '#fff',
    health: 100,
    maxHealth: 100,
    headlights: 0,
    turnSignal: 'none',
    isBraking: false,
    isReversing: false,
    isHonking: false,
    isSiren: false,
    isPlayer: false,
    smokeTimer: 0,
    ...overrides,
  };
}

function testSideImpactSpinsAndDazesThePlayer() {
  const physics = new PhysicsEngine();

  // Player driving east (angle 0) is T-boned from the north by a fast NPC
  // driving south (angle +90deg) - a classic off-center, high relative-
  // speed hit that should spin the player's car and daze its controls.
  const player = makeVehicle({ id: 'player', x: 0, y: 20, angle: 0, speed: 3, isPlayer: true });
  const npc = makeVehicle({ id: 'npc', x: 0, y: 0, angle: Math.PI / 2, speed: 18 });

  const startAngle = player.angle;
  physics.resolveAllCollisions([player, npc], [], [], [], undefined, DELTA);

  if (player.health >= 100) {
    throw new Error('hard T-bone did not damage the player');
  }
  if (Math.abs(player.angle - startAngle) < 0.02) {
    throw new Error(`off-center hit did not spin the player's car: angle delta ${(player.angle - startAngle).toFixed(3)}`);
  }
  if (!player.dazedTimer || player.dazedTimer <= 0) {
    throw new Error('hard impact left the player fully in control with no dazed window');
  }

  // A dazed driver should have less steering authority than an undazed one
  // under identical input, fading back in rather than snapping back.
  const dazedSteerAngle = player.steeringAngle;
  physics.updatePlayerVehicle(player, { throttle: false, brake: false, reverse: false, steerLeft: true, steerRight: false, handbrake: false }, DELTA);
  const dazedResponse = Math.abs(player.steeringAngle - dazedSteerAngle);

  const freshPlayer = makeVehicle({ id: 'fresh', x: 0, y: 0, angle: 0, speed: 3, isPlayer: true, steeringAngle: dazedSteerAngle });
  physics.updatePlayerVehicle(freshPlayer, { throttle: false, brake: false, reverse: false, steerLeft: true, steerRight: false, handbrake: false }, DELTA);
  const freshResponse = Math.abs(freshPlayer.steeringAngle - dazedSteerAngle);

  if (dazedResponse >= freshResponse) {
    throw new Error(
      `dazed steering was not reduced: dazed turned ${dazedResponse.toFixed(4)}, undazed turned ${freshResponse.toFixed(4)}`
    );
  }

  console.log(
    `FIXED: a hard T-bone spins the player's car (${((player.angle - startAngle) * 180 / Math.PI).toFixed(1)}deg) ` +
      `and dazes steering (${(dazedResponse / freshResponse * 100).toFixed(0)}% of normal response).`
  );
}

function testDazeFadesOut() {
  const physics = new PhysicsEngine();
  const player = makeVehicle({ id: 'player', dazedTimer: 1.0, isPlayer: true });

  for (let i = 0; i < 60; i += 1) {
    physics.updatePlayerVehicle(player, { throttle: false, brake: false, reverse: false, steerLeft: false, steerRight: false, handbrake: false }, DELTA);
  }

  if ((player.dazedTimer || 0) > 0) {
    throw new Error(`dazed window never expired: ${player.dazedTimer}s remaining after 2s`);
  }
  console.log('FIXED: the dazed window fades out on its own instead of persisting.');
}

testSideImpactSpinsAndDazesThePlayer();
testDazeFadesOut();
