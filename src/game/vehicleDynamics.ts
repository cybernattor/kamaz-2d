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
export const LOW_SPEED_WHEELBASE_RATIO = 1.1;
export const HIGH_SPEED_WHEELBASE_RATIO = 2.4;
const TIGHT_TURN_FULL_BELOW_KMH = 15;
const TIGHT_TURN_GONE_ABOVE_KMH = 90;

export function effectiveWheelbase(bodyLength: number, speedKmh: number): number {
  const t = Math.max(0, Math.min(1, (speedKmh - TIGHT_TURN_FULL_BELOW_KMH) / (TIGHT_TURN_GONE_ABOVE_KMH - TIGHT_TURN_FULL_BELOW_KMH)));
  const eased = t * t * (3 - 2 * t);
  return bodyLength * (LOW_SPEED_WHEELBASE_RATIO + (HIGH_SPEED_WHEELBASE_RATIO - LOW_SPEED_WHEELBASE_RATIO) * eased);
}

/**
 * Turning on the spot. Real cars can't yaw without moving, but a top-down
 * game where the player must creep forward and back to turn around feels
 * broken, so steering at a standstill pivots the vehicle slowly. The pivot
 * fades out by PIVOT_FADE_KMH where the normal kinematic turning takes over.
 * Longer vehicles pivot slower.
 */
export const PIVOT_RATE_RAD_PER_S = 2;
export const PIVOT_FADE_KMH = 6;
const PIVOT_REFERENCE_LENGTH = 46;

/** `steerRatio` is the steering input in -1..1; returns yaw rate in rad/s. */
export function pivotYawRate(steerRatio: number, bodyLength: number, speedKmh: number): number {
  const ratio = Math.max(-1, Math.min(1, steerRatio));
  const fade = Math.max(0, 1 - speedKmh / PIVOT_FADE_KMH);
  const eased = fade * fade * (3 - 2 * fade);
  return ratio * PIVOT_RATE_RAD_PER_S * Math.sqrt(PIVOT_REFERENCE_LENGTH / bodyLength) * eased;
}
