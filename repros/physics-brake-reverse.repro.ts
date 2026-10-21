import { integrateVehicleSpeed } from '../src/game/vehicleDynamics';
import { VEHICLE_CONFIGS } from '../src/game/vehicleConfigs';

// Brake pins a standing car at zero speed, so reverse only works when the
// brake input is released. The touch R toggle relies on this: it routes the
// gas pedal to `reverse`, never combining it with `brake`.
function settle(input: { brake?: boolean; reverse?: boolean }) {
  const config = Object.values(VEHICLE_CONFIGS)[0];
  let speed = 0;
  for (let i = 0; i < 120; i++) speed = integrateVehicleSpeed(speed, config, input as never, 1 / 60);
  return speed;
}

function main() {
  if (!(settle({ reverse: true }) < -0.5)) throw new Error('Reverse alone did not move the car backwards');
  if (settle({ brake: true, reverse: true }) !== 0) {
    throw new Error('Brake+reverse moved the car; the touch pedal must release brake before reversing');
  }
  console.log('FIXED: reverse works only with the brake released; brake holds a standing car.');
}

main();
