import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';

const DELTA = 1 / 60;

function main() {
  const traffic = new TrafficAI(new CityMap());
  // npc_car_0 is intentionally one of the permanent parking/abandonment
  // fixtures; use the next car to verify the resume-the-route branch here.
  const car = traffic.npcVehicles[1];
  if (!car) throw new Error('Parking fixture was not created');

  for (const other of traffic.npcVehicles) {
    if (other !== car) other.health = 0;
  }

  const ai = (traffic as unknown as { aiData: Map<string, { activity: string }> }).aiData.get(car.id);
  if (!ai) throw new Error('Parking AI state was not created');
  (traffic as unknown as { beginParking: (vehicle: typeof car, state: typeof ai) => void }).beginParking(car, ai);

  let sawPedestrianTrip = false;
  for (let frame = 0; frame < 720; frame += 1) {
    traffic.updateTraffic(DELTA);
    traffic.updatePedestrians(DELTA, car.x, car.y, false);
    sawPedestrianTrip ||= traffic.pedestrians.some((ped) => ped.vehicleId === car.id && ped.parkingRole);
  }

  if (!sawPedestrianTrip) throw new Error('Parking did not create an on-foot driver/passenger trip');
  if (ai.activity !== 'driving' || car.npcParked) {
    throw new Error('NPC did not leave the parking state after the driver returned');
  }

  const abandonedTraffic = new TrafficAI(new CityMap());
  const abandonedCar = abandonedTraffic.npcVehicles[0];
  if (!abandonedCar) throw new Error('Abandonment fixture was not created');
  const abandonedAi = (abandonedTraffic as unknown as { aiData: Map<string, { activity: string }> }).aiData.get(abandonedCar.id);
  if (!abandonedAi) throw new Error('Abandonment AI state was not created');
  (abandonedTraffic as unknown as { beginParking: (vehicle: typeof abandonedCar, state: typeof abandonedAi) => void })
    .beginParking(abandonedCar, abandonedAi);
  for (let frame = 0; frame < 720; frame += 1) {
    abandonedTraffic.updateTraffic(DELTA);
    abandonedTraffic.updatePedestrians(DELTA, abandonedCar.x, abandonedCar.y, false);
  }
  if (abandonedAi.activity !== 'parked' || !abandonedCar.npcParked) {
    throw new Error('Abandonment branch did not leave the NPC vehicle parked');
  }

  console.log('FIXED: NPC parked, generated pedestrian boarding activity, resumed a route, and supports leaving cars behind.');
}

main();
