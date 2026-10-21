import { PhysicsEngine } from '../src/game/physics';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { PIVOT_FADE_KMH, pivotYawRate } from '../src/game/vehicleDynamics';

// Seconds to turn 180 degrees on the spot with the stick held to one side.
function secondsToUTurn(type: keyof typeof VEHICLE_CONFIGS) {
  const physics = new PhysicsEngine();
  const vehicle: any = {
    id: 't', type, x: 1800, y: 1800, angle: 0, speed: 0, steeringAngle: 0, angularVelocity: 0,
    color: '#fff', health: 100, maxHealth: 100, headlights: 0, turnSignal: 'none', isBraking: false,
    isReversing: false, isHonking: false, isSiren: false, isPlayer: true, smokeTimer: 0,
  };
  for (let frame = 0; frame < 60 * 20; frame++) {
    physics.updatePlayerVehicle(
      vehicle,
      { throttle: false, brake: false, reverse: false, steerLeft: false, steerRight: false, handbrake: false, steerAxis: 1 },
      1 / 60,
    );
    if (vehicle.angle >= Math.PI) {
      const drift = Math.hypot(vehicle.x - 1800, vehicle.y - 1800);
      if (drift > 1) throw new Error(`${type} drifted ${drift.toFixed(1)} units while pivoting`);
      return frame / 60;
    }
  }
  throw new Error(`${type} never completed a U-turn on the spot`);
}

function main() {
  const sedan = secondsToUTurn('sedan');
  const kamaz = secondsToUTurn('kamaz_dump');
  if (!(sedan < 3)) throw new Error(`Sedan U-turn on the spot took ${sedan.toFixed(1)} s (want < 3)`);
  if (!(kamaz < 5)) throw new Error(`KAMAZ U-turn on the spot took ${kamaz.toFixed(1)} s (want < 5)`);
  if (!(kamaz > sedan)) throw new Error('A long truck must pivot slower than a sedan');

  if (pivotYawRate(0, 46, 0) !== 0) throw new Error('No steering must not pivot');
  if (pivotYawRate(1, 46, PIVOT_FADE_KMH) !== 0) throw new Error('Pivot must fade out by the fade speed');
  if (!(pivotYawRate(1, 46, 0) > pivotYawRate(1, 46, 3))) throw new Error('Pivot must fade as speed rises');
  if (pivotYawRate(-1, 46, 0) >= 0) throw new Error('Pivot direction must follow steering sign');

  console.log(`FIXED: standing U-turn takes ${sedan.toFixed(1)} s (sedan), ${kamaz.toFixed(1)} s (KAMAZ).`);
}

main();
