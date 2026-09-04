import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';
import { integrateVehicleSpeed } from '../src/game/vehicleDynamics';

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

  let speed = stillForward;
  for (let i = 0; i < 300; i += 1) speed = integrateVehicleSpeed(speed, config, { reverse: true }, DELTA);
  if (speed >= -0.1) throw new Error('reverse input never engaged after stopping');
}

testAllVehiclesReachTheirWorkingTopSpeed();
testClassDifferencesAndBraking();
testReverseRequiresStopping();
console.log('vehicle-dynamics: OK');
