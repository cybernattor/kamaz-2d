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
      const deceleration = target < speed - 0.5 ? config.braking * 0.72 : resistance;
      return moveToward(speed, target, deceleration * delta);
    }
    if (speed < target) {
      const ratio = Math.min(1, Math.max(0, speed / Math.max(maxForward, 0.1)));
      const drive = config.acceleration * Math.max(0.2, 1 - Math.pow(ratio, 1.35));
      return Math.min(target, speed + Math.max(0, drive - resistance) * delta);
    }
    return speed;
  }

  // Brake input always wins over throttle. The keyboard/mobile control maps
  // the same pedal to brake while moving forward and reverse after stopping.
  if (input.brake && speed > 0) {
    return Math.max(0, speed - config.braking * (input.handbrake ? 1.25 : 1) * delta);
  }

  if (input.reverse && speed > 0.05) {
    return Math.max(0, speed - config.braking * 0.8 * delta);
  }

  // Reverse is checked before throttle so a still-held W cannot immediately
  // cancel the gear change at standstill.
  if (input.reverse && speed <= 0.05) {
    const reverseRatio = Math.min(1, Math.abs(speed) / Math.max(maxReverse, 0.1));
    const drive = config.reverseAcceleration * Math.max(0.18, 1 - reverseRatio);
    return Math.max(-maxReverse, speed - Math.max(0, drive - resistance) * delta);
  }

  if (input.throttle && speed >= 0 && !input.brake && !input.reverse) {
    const drive = config.acceleration * Math.max(0.2, 1 - Math.pow(forwardRatio, 1.35));
    return Math.min(maxForward, Math.max(0, speed + (drive - resistance) * delta));
  }

  const coastDeceleration = resistance + (speed > 0 ? config.engineBraking : 0);
  return moveToward(speed, 0, coastDeceleration * delta);
}
