import { PhysicsEngine } from '../src/game/physics';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { HIGH_SPEED_WHEELBASE_RATIO, LOW_SPEED_WHEELBASE_RATIO, effectiveWheelbase } from '../src/game/vehicleDynamics';

// Full-lock turning radius at a held speed, in body lengths.
function turnRadiusInLengths(type: keyof typeof VEHICLE_CONFIGS, kmh: number) {
  const physics = new PhysicsEngine();
  const config = VEHICLE_CONFIGS[type];
  const vehicle: any = {
    id: 't', type, x: 1800, y: 1800, angle: 0, speed: kmh / 3.6, steeringAngle: 0, angularVelocity: 0,
    color: '#fff', health: 100, maxHealth: 100, headlights: 0, turnSignal: 'none', isBraking: false,
    isReversing: false, isHonking: false, isSiren: false, isPlayer: true, smokeTimer: 0,
  };
  let omegaSum = 0;
  let samples = 0;
  for (let i = 0; i < 120; i++) {
    vehicle.speed = kmh / 3.6;
    physics.updatePlayerVehicle(
      vehicle,
      { throttle: false, brake: false, reverse: false, steerLeft: false, steerRight: false, handbrake: false, steerAxis: 1 },
      1 / 60,
    );
    if (i > 60) {
      omegaSum += Math.abs(vehicle.angularVelocity);
      samples++;
    }
  }
  return ((kmh / 3.6) * 60) / (omegaSum / samples) / config.length;
}

function main() {
  // Parking-speed turns used to need ~4.5 body lengths of radius, forcing
  // multi-point turns on junctions and U-turns.
  for (const type of ['sedan', 'kamaz_dump', 'bus'] as const) {
    const radius = turnRadiusInLengths(type, 10);
    if (!(radius < 2.6)) throw new Error(`${type} low-speed turning circle is ${radius.toFixed(2)} lengths (want < 2.6)`);
  }
  // Highway handling must stay as stable as before.
  const highway = turnRadiusInLengths('sedan', 100);
  if (!(highway > 4.5)) throw new Error(`Highway turning became too sharp (${highway.toFixed(2)} lengths)`);

  if (effectiveWheelbase(40, 0) !== 40 * LOW_SPEED_WHEELBASE_RATIO) throw new Error('Standstill wheelbase must be the short base');
  if (effectiveWheelbase(40, 200) !== 40 * HIGH_SPEED_WHEELBASE_RATIO) throw new Error('High-speed wheelbase must be the long base');
  let previous = 0;
  for (let kmh = 0; kmh <= 120; kmh += 5) {
    const value = effectiveWheelbase(40, kmh);
    if (value < previous) throw new Error('Wheelbase must not shrink as speed rises');
    previous = value;
  }
  console.log('FIXED: tight low-speed turning circle, unchanged highway stability.');
}

main();
