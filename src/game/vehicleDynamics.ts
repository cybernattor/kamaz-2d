import { VehicleConfig } from '../types';
import { KMH_TO_WORLD_SPEED } from './vehicleConfigs';

export const MAX_PHYSICS_DELTA = 0.1;

export interface LongitudinalInput {
  throttle?: boolean;
  brake?: boolean;
  reverse?: boolean;
  handbrake?: boolean;
  targetSpeed?: number;
}

function moveToward(value: number, target: number, amount: number) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

/** Integrates speed in m/s while retaining the game's existing world scale. */
export function integrateVehicleSpeed(
  speed: number,
  config: VehicleConfig,
  input: LongitudinalInput,
  rawDelta: number,
) {
  const delta = Math.min(MAX_PHYSICS_DELTA, Math.max(0, rawDelta));
  if (delta === 0) return speed;

  const maxForward = config.maxSpeed * KMH_TO_WORLD_SPEED;
  const maxReverse = config.reverseSpeed * KMH_TO_WORLD_SPEED;
  const magnitude = Math.abs(speed);
  const forwardRatio = Math.min(1, magnitude / Math.max(maxForward, 0.1));
  const resistance = config.rollingResistance + config.airResistance * forwardRatio * forwardRatio;

  if (input.targetSpeed !== undefined) {
    const target = Math.max(0, Math.min(maxForward, input.targetSpeed));
    if (speed > target) {
      // Service braking when well above the target or stopping; within half
      // a unit of the target, modulate the brake in proportion to the excess
      // like a driver easing off. A dead band with only rolling resistance
      // let a car told to stop creep past stop lines, and let a follower
      // close on a slowing leader until it was too late.
      const serviceBraking = config.braking * 0.72;
      const excess = speed - target;
      const deceleration = excess > 0.5 || target <= 0.01
        ? serviceBraking
        : Math.max(resistance, serviceBraking * (excess / 0.5));
      return moveToward(speed, target, deceleration * delta);
    }
    if (speed < target) {
      const ratio = Math.min(1, Math.max(0, speed / Math.max(maxForward, 0.1)));
      const drive = config.acceleration * Math.max(0.2, 1 - Math.pow(ratio, 1.35));
      return Math.min(target, speed + Math.max(0, drive - resistance) * 0.8 * delta);
    }
    return speed;
  }

  // Brake input always wins over throttle. Reverse is a separate input and
  // never acts as a brake while the vehicle is moving forward.
  if (input.brake && speed !== 0) {
    // Brakes must oppose the current direction. The old forward-only clamp
    // made Space ineffective while reversing, leaving only rolling resistance.
    return moveToward(speed, 0, config.braking * (input.handbrake ? 1.25 : 1) * delta);
  }

  if (input.reverse && speed > 0.05) {
    // Reverse is an opposing drive request, not passive coasting. Apply
    // reverse torque immediately so a moving car can change direction
    // without waiting for a separate full-stop phase.
    const reverseDrive = config.reverseAcceleration * 0.8 + resistance;
    return Math.max(-maxReverse, speed - reverseDrive * delta);
  }

  // Reverse is checked before throttle so a still-held W cannot immediately
  // cancel the gear change at standstill.
  if (input.reverse && speed <= 0.05) {
    const reverseRatio = Math.min(1, Math.abs(speed) / Math.max(maxReverse, 0.1));
    const drive = config.reverseAcceleration * Math.max(0.18, 1 - reverseRatio);
    return Math.max(-maxReverse, speed - Math.max(0, drive - resistance) * delta);
  }

  if (input.throttle && speed < -0.05 && !input.brake && !input.reverse) {
    // Forward throttle mirrors reverse: it counters backward motion directly
    // and naturally crosses through zero instead of requiring a dead stop.
    const forwardDrive = config.acceleration * 0.64 + resistance;
    return Math.min(maxForward, speed + forwardDrive * delta);
  }

  if (input.throttle && speed >= 0 && !input.brake && !input.reverse) {
    const drive = config.acceleration * Math.max(0.2, 1 - Math.pow(forwardRatio, 1.35));
    return Math.min(maxForward, Math.max(0, speed + (drive - resistance) * 0.8 * delta));
  }

  const coastDeceleration = resistance + (speed > 0 ? config.engineBraking : 0);
  return moveToward(speed, 0, coastDeceleration * delta);
}

/**
 * Wheelbase used for the player's turning model, as a multiple of body length.
 * The old constant 2.4 gave a turning circle of ~4.5 body lengths at parking
 * speed (a KAMAZ needed ~340 units to turn on a 92-unit road, so corners and
 * U-turns took several tries). Low speed now uses a short base for a tight
 * ~2-length circle, and the base blends back to the old value as speed rises
 * so highway handling stays as stable as before.
 */
export const LOW_SPEED_WHEELBASE_RATIO = 0.9;
export const HIGH_SPEED_WHEELBASE_RATIO = 2.4;
const TIGHT_TURN_FULL_BELOW_KMH = 15;
const TIGHT_TURN_GONE_ABOVE_KMH = 90;

export function effectiveWheelbase(bodyLength: number, speedKmh: number): number {
  const t = Math.max(0, Math.min(1, (speedKmh - TIGHT_TURN_FULL_BELOW_KMH) / (TIGHT_TURN_GONE_ABOVE_KMH - TIGHT_TURN_FULL_BELOW_KMH)));
  const eased = t * t * (3 - 2 * t);
  return bodyLength * (LOW_SPEED_WHEELBASE_RATIO + (HIGH_SPEED_WHEELBASE_RATIO - LOW_SPEED_WHEELBASE_RATIO) * eased);
}

/**
 * Front-wheel lock angle (rad). A real car turns its wheels ~35-40 degrees at
 * parking speed; the game used a flat 0.5 rad (28.6 degrees) at every speed,
 * which with a long base felt sluggish. Full real-world lock is used at low
 * speed and fades back to the old angle with the same blend as the wheelbase,
 * so highway steering does not get twitchier.
 */
export const LOW_SPEED_STEER_LOCK = 0.62;
export const HIGH_SPEED_STEER_LOCK = 0.5;

export function steeringLockAngle(speedKmh: number): number {
  const t = Math.max(0, Math.min(1, (speedKmh - TIGHT_TURN_FULL_BELOW_KMH) / (TIGHT_TURN_GONE_ABOVE_KMH - TIGHT_TURN_FULL_BELOW_KMH)));
  const eased = t * t * (3 - 2 * t);
  return LOW_SPEED_STEER_LOCK + (HIGH_SPEED_STEER_LOCK - LOW_SPEED_STEER_LOCK) * eased;
}

/**
 * Tyre-grip ceiling on lateral acceleration, in world units/s^2 per point of
 * the vehicle's `turnSpeed`. Yaw from the bicycle model scales with
 * speed / body length, so short, fast cars turned 2-3x harder than a KAMAZ
 * (a hatchback at 100 km/h spun at ~8 rad/s, more than a full turn per
 * second) and a tap of A/D threw them across the road. A real car cannot
 * corner harder than its tyres allow, so yaw is capped at a_max / v:
 * parking-speed turns keep their full geometric lock, while highway turns
 * become smooth arcs. `turnSpeed` (previously unused) ranks vehicles, so a
 * sports coupe still out-corners a bus.
 */
export const LATERAL_GRIP_PER_TURN_SPEED = 1100;

export function maxGripYawRate(turnSpeed: number, worldSpeedPerSecond: number): number {
  const lateralLimit = LATERAL_GRIP_PER_TURN_SPEED * turnSpeed;
  return lateralLimit / Math.max(1, Math.abs(worldSpeedPerSecond));
}

/**
 * How fast the front wheels move toward the requested angle (1/s). Keys are
 * all-or-nothing, so at speed the wheel is turned in more gently, giving the
 * player time to make small corrections; releasing a key or counter-steering
 * always recentres quickly so the car straightens without wobbling.
 */
export const STEER_RETURN_RATE = 12;

export function steerRate(speedKmh: number, maxSpeedKmh: number, increasing: boolean, analog: boolean): number {
  if (!increasing) return STEER_RETURN_RATE;
  if (analog) return 9;
  const ratio = Math.max(0, Math.min(1, speedKmh / Math.max(1, maxSpeedKmh)));
  return 8 - 4.5 * ratio;
}

/**
 * Arcade pedal mapping for the keyboard: the "down" key (S / ArrowDown)
 * brakes with full force while the car still rolls forward, then engages
 * reverse once it has stopped; "up" (W / ArrowUp) does the same while rolling
 * backwards. Previously S only applied weak reverse torque as a brake, and
 * ArrowDown braked but could never reverse.
 */
export function resolveKeyboardPedals(speed: number, up: boolean, down: boolean, brakeKey: boolean) {
  const ROLLING = 0.6;
  let throttle = up;
  let reverse = down;
  let brake = brakeKey;
  if (down && !up && speed > ROLLING) {
    reverse = false;
    brake = true;
  }
  if (up && !down && speed < -ROLLING) {
    throttle = false;
    brake = true;
  }
  return { throttle, reverse, brake };
}
