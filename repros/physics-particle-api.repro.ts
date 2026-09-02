import { PhysicsEngine } from '../src/game/physics';

function main() {
  const physics = new PhysicsEngine();
  physics.spawnExplosionParticles(100, 100, 'crate');
  physics.spawnExplosionParticles(120, 100, 'hydrant');
  physics.spawnSparks(140, 100);

  if (physics.particles.length === 0) {
    throw new Error('Particle compatibility helpers emitted no particles');
  }

  console.log(`FIXED: particle event helpers emitted ${physics.particles.length} particles.`);
}

main();
