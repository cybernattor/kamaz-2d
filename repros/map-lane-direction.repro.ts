import { CityMap } from '../src/game/cityMap';

const map = new CityMap();
const arterial = map.roads.find((road) => road.id === 'road_v_1');
if (!arterial || arterial.lanesPerDirection !== 2 || arterial.lanes !== 4) {
  throw new Error('arterial must expose four independent lanes');
}

const south = map.getLaneCenters(arterial.id, 'south');
const north = map.getLaneCenters(arterial.id, 'north');
if (south.length !== 2 || north.length !== 2 || !(south.every((lane) => lane.x > arterial.x1) && north.every((lane) => lane.x < arterial.x1))) {
  throw new Error('vertical right-hand traffic lane sides are incorrect');
}

const horizontal = map.roads.find((road) => road.id === 'road_h_0');
if (!horizontal) throw new Error('horizontal arterial missing');
const east = map.getLaneCenters(horizontal.id, 'east');
const west = map.getLaneCenters(horizontal.id, 'west');
if (!(east.every((lane) => lane.y > horizontal.y1) && west.every((lane) => lane.y < horizontal.y1))) {
  throw new Error('horizontal right-hand traffic lane sides are incorrect');
}

const oneWay = map.roads.find((road) => road.id === 'road_h_1');
if (!oneWay || map.getLaneCenters(oneWay.id, 'east').length !== 2 || map.getLaneCenters(oneWay.id, 'west').length !== 0) {
  throw new Error('one-way road exposes lanes against its travel direction');
}

console.log('FIXED: arterials expose 4 lanes and all four directions use the right-hand side.');
