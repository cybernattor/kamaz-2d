import { CityMap, MapRect, WORLD_SIZE } from '../src/game/cityMap';

const map = new CityMap();
const failures: string[] = [];

const overlaps = (a: MapRect, b: MapRect) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;

// 1. Buildings are solid AABB colliders. One on the carriageway is an invisible
// wall on an NPC lane; one inside a POI seals off a mission loading zone.
for (const building of map.buildings) {
  const clearance = map.clearanceToRoads(building);
  if (clearance < 0) {
    failures.push(`building ${building.id} intrudes ${(-clearance).toFixed(0)}px into a road`);
  }
  const poi = map.pois.find((candidate) => overlaps(building, candidate));
  if (poi) failures.push(`building ${building.id} overlaps ${poi.id}`);
  const other = map.buildings.find((candidate) => candidate.id !== building.id && overlaps(building, candidate));
  if (other) failures.push(`building ${building.id} overlaps building ${other.id}`);
  if (building.width <= 0 || building.height <= 0) failures.push(`building ${building.id} is degenerate`);
}

// 2. Every district needs buildings. The old placement filter measured a single
// axis against isolated road vertices, which culled whole districts at once.
for (const district of map.districts) {
  const count = map.buildings.filter((building) =>
    Math.abs(building.x - district.x) <= district.width / 2
    && Math.abs(building.y - district.y) <= district.height / 2).length;
  if (count === 0) failures.push(`district ${district.id} has no buildings`);
}

// 3. Districts must tile, not overlap: the overview map paints them translucent
// and stacks a label in every corner.
for (let i = 0; i < map.districts.length; i++) {
  for (let j = i + 1; j < map.districts.length; j++) {
    const a = map.districts[i];
    const b = map.districts[j];
    if (overlaps(a, b)) failures.push(`district ${a.id} overlaps ${b.id}`);
  }
}

// 4. POI ground decals are drawn over the asphalt and carry parking stalls, so
// they must not cover a carriageway, or each other.
for (const poi of map.pois) {
  const clearance = map.clearanceToRoads(poi);
  if (clearance < 0) failures.push(`poi ${poi.id} intrudes ${(-clearance).toFixed(0)}px into a road`);
  const other = map.pois.find((candidate) => candidate.id !== poi.id && overlaps(poi, candidate));
  if (other) failures.push(`poi ${poi.id} overlaps ${other.id}`);
}

// 5. Props must sit on the verge, never on a lane or inside a wall.
for (const prop of map.destructibles) {
  if (map.isOnRoad(prop.x, prop.y)) failures.push(`prop ${prop.id} (${prop.type}) sits on a road`);
  const building = map.buildings.find((candidate) =>
    Math.abs(prop.x - candidate.x) < candidate.width / 2 && Math.abs(prop.y - candidate.y) < candidate.height / 2);
  if (building) failures.push(`prop ${prop.id} is buried inside ${building.id}`);
  if (prop.x < 0 || prop.y < 0 || prop.x > WORLD_SIZE || prop.y > WORLD_SIZE) {
    failures.push(`prop ${prop.id} is outside the world`);
  }
}

// 6. Every road has to be reachable by the planner. A road that is drawn and
// driveable but absent from the graph can never appear in a mission route.
const routableRoads = new Set(map.roadEdges.map((edge) => edge.roadId));
for (const road of map.roads) {
  if (!routableRoads.has(road.id)) failures.push(`road ${road.id} is missing from the routing graph`);
}

// 7. Multiplayer syncs destructibles by id only, so two clients must generate
// the same layout or one player destroys a prop the other sees elsewhere.
const second = new CityMap();
if (JSON.stringify(map.destructibles) !== JSON.stringify(second.destructibles)) {
  failures.push('destructible layout is not deterministic between CityMap instances');
}

if (failures.length > 0) {
  throw new Error(`MAP_STATIC_PLACEMENT_FAILED\n${failures.join('\n')}`);
}

console.log(
  `FIXED: ${map.buildings.length} buildings, ${map.pois.length} POIs and ${map.destructibles.length} props are clear of every carriageway, and all ${map.roads.length} roads are routable.`
);
