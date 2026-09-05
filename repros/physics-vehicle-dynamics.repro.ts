import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { integrateVehicleSpeed } from '../src/game/vehicleDynamics';
import { PhysicsEngine } from '../src/game/physics';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

function accelerate(type: keyof typeof VEHICLE_CONFIGS, seconds: number, targetSpeed?: number) {
  const config = VEHICLE_CONFIGS[type];
  let speed = 0;
  for (let i = 0; i < seconds / DELTA; i += 1) {
    speed = integrateVehicleSpeed(speed, config, targetSpeed === undefined ? { throttle: true } : { targetSpeed }, DELTA);
  }
  return speed;
}

function testAllVehiclesReachTheirWorkingTopSpeed() {
  for (const config of Object.values(VEHICLE_CONFIGS)) {
    const speedKmh = accelerate(config.id, 60) * 3.6;
    if (speedKmh < config.maxSpeed * 0.95) {
      throw new Error(`${config.id} only reached ${speedKmh.toFixed(1)} km/h of ${config.maxSpeed}`);
    }
  }
}

function testClassDifferencesAndBraking() {
  const truckTo50 = accelerate('kamaz_dump', 5);
  const sedanTo50 = accelerate('sedan', 5);
  const sportsTo50 = accelerate('sports', 5);
  if (truckTo50 >= sedanTo50 || sedanTo50 >= sportsTo50) {
    throw new Error('vehicle acceleration hierarchy is not realistic');
  }

  const config = VEHICLE_CONFIGS.sedan;
  let speed = 100 / 3.6;
  let distance = 0;
  for (let i = 0; i < 600; i += 1) {
    distance += speed * DELTA;
    speed = integrateVehicleSpeed(speed, config, { brake: true }, DELTA);
    if (speed === 0) break;
  }
  if (distance < 35 || distance > 100) throw new Error(`unexpected 100-0 braking distance: ${distance.toFixed(1)}m`);
}

function testReverseRequiresStopping() {
  const config = VEHICLE_CONFIGS.sedan;
  const stillForward = integrateVehicleSpeed(8, config, { reverse: true }, DELTA);
  if (stillForward <= 0) throw new Error('reverse input changed direction without stopping');

  let speed = 0;
  for (let i = 0; i < 300; i += 1) speed = integrateVehicleSpeed(speed, config, { reverse: true }, DELTA);
  if (speed >= -0.1) throw new Error('reverse input did not engage from a stopped vehicle');
}

function testBrakeAndReverseInputPriority() {
  const config = VEHICLE_CONFIGS.kamaz_dump;
  const afterBrake = integrateVehicleSpeed(20, config, { throttle: true, brake: true }, DELTA);
  if (afterBrake >= 20) throw new Error('brake did not override throttle for a heavy vehicle');

  let speed = 20;
  for (let i = 0; i < 240; i += 1) speed = integrateVehicleSpeed(speed, config, { brake: true }, DELTA);
  if (speed !== 0) throw new Error('brake did not bring a heavy vehicle to a full stop');
  speed = integrateVehicleSpeed(speed, config, { reverse: true }, DELTA);
  if (speed >= -0.01) throw new Error('reverse did not engage from a stopped vehicle');
}

function testSpaceBrakeWorksForEveryVehicle() {
  for (const config of Object.values(VEHICLE_CONFIGS)) {
    let speed = config.maxSpeed / 3.6;
    let seconds = 0;
    while (speed > 0 && seconds < 20) {
      speed = integrateVehicleSpeed(speed, config, { brake: true }, DELTA);
      seconds += DELTA;
    }
    if (speed > 0 || seconds > 12) {
      throw new Error(`${config.id} did not stop with Space brake in reasonable time`);
    }
  }
}

function testSteeringNeedsForwardMotion() {
  const physics = new PhysicsEngine();
  const vehicle: VehicleInstance = {
    id: 'steering-test',
    type: 'sedan',
    x: 1000,
    y: 1000,
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
    isPlayer: true,
    smokeTimer: 0,
  };
  physics.updatePlayerVehicle(vehicle, {
    throttle: false,
    brake: false,
    reverse: false,
    steerLeft: true,
    steerRight: false,
    handbrake: false,
  }, DELTA);
  if (vehicle.angle !== 0 || vehicle.angularVelocity !== 0) {
    throw new Error('stationary vehicle rotated without forward motion');
  }

  vehicle.speed = 1;
  physics.updatePlayerVehicle(vehicle, {
    throttle: false,
    brake: false,
    reverse: false,
    steerLeft: true,
    steerRight: false,
    handbrake: false,
  }, DELTA);
  const lowSpeedYaw = Math.abs(vehicle.angularVelocity);
  vehicle.speed = 10;
  physics.updatePlayerVehicle(vehicle, {
    throttle: false,
    brake: false,
    reverse: false,
    steerLeft: true,
    steerRight: false,
    handbrake: false,
  }, DELTA);
  if (lowSpeedYaw <= 0 || Math.abs(vehicle.angularVelocity) <= lowSpeedYaw) {
    throw new Error('steering yaw is not proportional to forward speed');
  }
}

testAllVehiclesReachTheirWorkingTopSpeed();
testClassDifferencesAndBraking();
testReverseRequiresStopping();
testBrakeAndReverseInputPriority();
testSpaceBrakeWorksForEveryVehicle();
testSteeringNeedsForwardMotion();
console.log('vehicle-dynamics: OK');
