import { CityMap, RoadPoint } from '../src/game/cityMap';

const map = new CityMap();
const failures: string[] = [];

const distanceToSegment = (point: RoadPoint, start: RoadPoint, end: RoadPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
};

const distanceToRoad = (point: RoadPoint, roadId: string) => {
  const road = map.roads.find((candidate) => candidate.id === roadId);
  if (!road) return Infinity;
  return Math.min(...road.points.slice(1).map((end, index) => distanceToSegment(point, road.points[index], end)));
};

for (const edge of map.roadEdges) {
  const road = map.roads.find((candidate) => candidate.id === edge.roadId);
  const from = map.roadNodes.find((candidate) => candidate.id === edge.from);
  const to = map.roadNodes.find((candidate) => candidate.id === edge.to);
  if (!road || !from || !to) {
    failures.push(`edge ${edge.id} references a missing road or node`);
    continue;
  }
  const tolerance = road.width / 2;
  const fromDistance = distanceToRoad(from, road.id);
  const toDistance = distanceToRoad(to, road.id);
  if (fromDistance > tolerance || toDistance > tolerance) {
    failures.push(`edge ${edge.id} leaves its road (from=${fromDistance.toFixed(1)}, to=${toDistance.toFixed(1)}, tolerance=${tolerance})`);
  }
  if (road.directionMode === 'one-way' && !edge.oneWay) {
    failures.push(`one-way road ${road.id} exposes a two-way graph edge ${edge.id}`);
  }
}

for (const intersection of map.intersections.filter((candidate) => candidate.id.startsWith('inter_') && /^inter_\d+_\d+$/.test(candidate.id))) {
  const [, xIndex, yIndex] = intersection.id.split('_');
  const verticalRoad = `road_v_${xIndex}`;
  const horizontalRoad = `road_h_${yIndex}`;
  const point = { x: intersection.x, y: intersection.y };
  const verticalDistance = distanceToRoad(point, verticalRoad);
  const horizontalDistance = distanceToRoad(point, horizontalRoad);
  if (verticalDistance > 5 || horizontalDistance > 5) {
    failures.push(`intersection ${intersection.id} is off its centerlines (vertical=${verticalDistance.toFixed(1)}, horizontal=${horizontalDistance.toFixed(1)})`);
  }
}

for (const road of map.roads.filter((candidate) => candidate.directionMode === 'one-way')) {
  const dx = road.x2 - road.x1;
  const dy = road.y2 - road.y1;
  const allowedDirection = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'east' : 'west')
    : (dy >= 0 ? 'south' : 'north');
  const forbiddenDirection = allowedDirection === 'east' ? 'west'
    : allowedDirection === 'west' ? 'east'
    : allowedDirection === 'south' ? 'north'
    : 'south';
  if (map.getLaneCenters(road.id, forbiddenDirection).length > 0) {
    failures.push(`one-way road ${road.id} exposes forbidden ${forbiddenDirection} lane centers`);
  }
}

if (failures.length > 0) {
  throw new Error(`MAP_GEOMETRY_INTEGRITY_FAILED\n${failures.join('\n')}`);
}

console.log('MAP_GEOMETRY_INTEGRITY_OK');
