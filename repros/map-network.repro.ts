import { CityMap } from '../src/game/cityMap';

const map = new CityMap();
if (map.districts.length !== 6) throw new Error(`expected six districts, got ${map.districts.length}`);
if (map.roads.some((road) => road.points.length < 2)) throw new Error('every road needs a polyline');
for (const feature of ['bridge', 'tunnel', 'rail_crossing', 'roundabout', 'ramp', 'winding']) {
  if (!map.roads.some((road) => road.feature === feature)) throw new Error(`missing road feature: ${feature}`);
}
if (map.roadNodes.length < 6 || map.roadEdges.length < 12) throw new Error('road graph is too small');
if (map.roadEdges.some((edge) => {
  const road = map.roads.find((candidate) => candidate.id === edge.roadId);
  return road?.directionMode === 'one-way' && !edge.oneWay;
})) throw new Error('one-way road exposes a reverse graph edge');

const majorPairs: Array<[string, string]> = [
  ['poi_port', 'poi_quarry'],
  ['poi_airport', 'poi_camp'],
  ['poi_depot', 'poi_truck_stop'],
];
for (const [source, target] of majorPairs) {
  const route = map.getRouteBetweenPois(source, target);
  if (route.length === 0) throw new Error(`no route from ${source} to ${target}`);
}

const direct = map.getRouteBetweenPois('poi_port', 'poi_quarry');
const alternate = map.getRouteBetweenPois('poi_port', 'poi_quarry', [direct[0]]);
if (alternate.length === 0 || alternate.join('|') === direct.join('|')) throw new Error('blocked route has no alternative');

console.log(`FIXED: ${map.districts.length} districts, ${map.roads.length} polyline roads and an A* graph with alternatives are available.`);
