import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';

const map = new CityMap();
const traffic = new TrafficAI(map);
const route = map.getRouteBetweenPois('poi_port', 'poi_quarry');
if (route.length < 2) throw new Error('NPC route must cross multiple road segments');
const arterial = map.roads.find((road) => road.id === 'road_v_1');
if (!arterial || arterial.lanesPerDirection !== 2) throw new Error('turn route lacks a two-lane direction model');

const first = traffic.npcVehicles[0];
if (!first || first.speed < 0 || traffic.npcVehicles.length < 20) throw new Error('NPC traffic did not initialize');
for (let tick = 0; tick < 180; tick += 1) traffic.updateTraffic(1 / 60);
if (traffic.npcVehicles.some((car) => !Number.isFinite(car.x) || !Number.isFinite(car.y))) throw new Error('NPC route update produced invalid coordinates');

console.log(`FIXED: NPC route graph returned ${route.length} segments and remained stable for 3 seconds of simulation.`);
