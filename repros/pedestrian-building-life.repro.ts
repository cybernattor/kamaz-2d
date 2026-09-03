import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';

const map = new CityMap();
const traffic = new TrafficAI(map);
const ped = traffic.pedestrians.find((candidate) => candidate.buildingId && candidate.lifeStage === 'toSidewalk');

if (!ped) throw new Error('No pedestrian received a building-life route');

// Arrive at the sidewalk connector, then at the door. The simulation must
// transition through entering and hide the resident indoors instead of walking
// through the building footprint.
ped.x = ped.targetX;
ped.y = ped.targetY;
traffic.updatePedestrians(1 / 30, 0, 0, false);
if (ped.state !== 'entering' || ped.lifeStage !== 'toDoor') {
  throw new Error(`Pedestrian did not start entering a building: ${ped.state}/${ped.lifeStage}`);
}
ped.x = ped.targetX;
ped.y = ped.targetY;
traffic.updatePedestrians(1 / 30, 0, 0, false);
if ((ped as { state: string }).state !== 'indoors') throw new Error(`Pedestrian did not enter the building: ${ped.state}`);

for (let i = 0; i < 650; i += 1) traffic.updatePedestrians(1 / 30, 0, 0, false);
if ((ped as { state: string }).state === 'indoors') throw new Error('Pedestrian never left the building after the indoor timer');
if (map.isOnRoad(ped.x, ped.y)) throw new Error('Building-life pedestrian appeared on the roadway');

console.log('pedestrian-building-life: OK - resident enters, stays inside, and returns through a sidewalk connector');
