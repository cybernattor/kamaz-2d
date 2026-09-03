import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

function main() {
  const physics = new PhysicsEngine();
  physics.spawnExplosionParticles(100, 100, 'crate');
  physics.spawnExplosionParticles(120, 100, 'hydrant');
  physics.spawnSparks(140, 100);

  const unattendedBurningVehicle: VehicleInstance = {
    id: 'unattended-burning-vehicle', type: 'sedan', x: 160, y: 100, angle: 0, speed: 0,
    steeringAngle: 0, angularVelocity: 0, color: '#fff', health: 15, maxHealth: 100,
    headlights: 0, turnSignal: 'none', isBraking: true, isReversing: false, isHonking: false,
    isSiren: false, isPlayer: true, smokeTimer: 0,
  };
  physics.updateVehicleDamageEffects(unattendedBurningVehicle, 0.05);

  if (!physics.particles.some((particle) => particle.type === 'fire')) {
    throw new Error('An unattended burning vehicle emitted no fire particle');
  }

  console.log(`FIXED: particle event helpers emitted ${physics.particles.length} particles.`);
}

main();
