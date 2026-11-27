import { PhysicsEngine } from '../src/game/physics';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { resolveKeyboardPedals } from '../src/game/vehicleDynamics';

// Passenger cars used to yaw 2-3x faster than a KAMAZ at the same speed
// (hatchback ~8 rad/s at 100 km/h), so a tap of A/D threw them off the road.
function heldYaw(type: keyof typeof VEHICLE_CONFIGS, kmh: number, frames = 90) {
  const physics = new PhysicsEngine();
  const vehicle: any = {
    id: 't', type, x: 1800, y: 1800, angle: 0, speed: kmh / 3.6, steeringAngle: 0, angularVelocity: 0,
    color: '#fff', health: 100, maxHealth: 100, headlights: 0, turnSignal: 'none', isBraking: false,
    isReversing: false, isHonking: false, isSiren: false, isPlayer: true, smokeTimer: 0,
  };
  for (let i = 0; i < frames; i++) {
    vehicle.speed = kmh / 3.6;
    vehicle.x = 1800;
    vehicle.y = 1800;
    physics.updatePlayerVehicle(vehicle, {
      throttle: false, brake: false, reverse: false, steerLeft: true, steerRight: false, handbrake: false,
    }, 1 / 60);
  }
  return { yaw: Math.abs(vehicle.angularVelocity), steer: Math.abs(vehicle.steeringAngle), vehicle, physics };
}

function main() {
  for (const type of ['sedan', 'hatchback', 'sports', 'police', 'taxi'] as const) {
    const yaw = heldYaw(type, 100).yaw;
    if (!(yaw < 3.6)) throw new Error(`${type} yaws ${yaw.toFixed(2)} rad/s at 100 km/h (want < 3.6)`);
    const truck = heldYaw('kamaz_dump', 80).yaw;
    if (!(heldYaw(type, 80).yaw < truck * 1.6)) throw new Error(`${type} corners far harder than a KAMAZ at 80 km/h`);
  }
  // Agility ranking from turnSpeed still holds at speed.
  if (!(heldYaw('sports', 100).yaw > heldYaw('ambulance', 100).yaw)) throw new Error('Sports coupe should out-corner the ambulance');

  // Keys turn the wheel in gently at speed but recentre fast.
  const fast = heldYaw('sedan', 110, 6).steer;
  const slow = heldYaw('sedan', 10, 6).steer;
  if (!(fast < slow)) throw new Error('Keyboard steering should ramp in slower at speed');
  const { vehicle, physics } = heldYaw('sedan', 60);
  const held = Math.abs(vehicle.steeringAngle);
  for (let i = 0; i < 12; i++) {
    physics.updatePlayerVehicle(vehicle, {
      throttle: false, brake: false, reverse: false, steerLeft: false, steerRight: false, handbrake: false,
    }, 1 / 60);
  }
  if (!(Math.abs(vehicle.steeringAngle) < held * 0.15)) throw new Error('Steering did not recentre within 0.2 s');

  // S / ArrowDown brakes hard while rolling forward, reverses once stopped.
  const rolling = resolveKeyboardPedals(10, false, true, false);
  if (!rolling.brake || rolling.reverse) throw new Error('Down key must brake while moving forward');
  const stopped = resolveKeyboardPedals(0, false, true, false);
  if (stopped.brake || !stopped.reverse) throw new Error('Down key must reverse at standstill');
  const backing = resolveKeyboardPedals(-5, true, false, false);
  if (!backing.brake || backing.throttle) throw new Error('Up key must brake while rolling backwards');

  console.log('FIXED: grip-limited car yaw, speed-aware key steering, brake-then-reverse pedals.');
}

main();
