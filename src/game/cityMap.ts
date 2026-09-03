import { DestructibleObject, MapDecoration, MapTrail, PointOfInterest, TrafficLight } from '../types';

export type RoadClass = 'arterial' | 'street' | 'highway' | 'service' | 'dirt';
export type RoadFeature = 'bridge' | 'tunnel' | 'roundabout' | 'rail_crossing' | 'ramp' | 'winding';

export interface RoadPoint {
  x: number;
  y: number;
}

export interface RoadSegment {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  lanes: number; // 2 or 4
  speedLimit: number;
  isVertical: boolean;
  /** Full centerline used by the renderer and the route planner. */
  points: RoadPoint[];
  roadClass: RoadClass;
  lanesPerDirection: 1 | 2;
  directionMode: 'two-way' | 'one-way';
  districtId: string;
  feature?: RoadFeature;
  fromNode?: string;
  toNode?: string;
  /**
   * Points where a bridge/tunnel road crosses another road at grade. The
   * renderer uses these to draw pier shadows (bridge) or portal mouths
   * (tunnel) so a grade-separated crossing reads as intentional instead of
   * two roads that were simply drawn on top of each other.
   */
  gradeCrossings?: RoadPoint[];
}

export interface RoadNetworkNode {
  id: string;
  x: number;
  y: number;
  kind: 'junction' | 'terminal' | 'roundabout';
}

export interface RoadNetworkEdge {
  id: string;
  from: string;
  to: string;
  roadId: string;
  length: number;
  speedLimit: number;
  oneWay: boolean;
}

export interface CityDistrict {
  id: string;
  name: string;
  kind: 'downtown' | 'residential' | 'port' | 'industrial' | 'desert' | 'nature';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  accent: string;
}

export interface Intersection {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  timer: number;
  phase: number; // 0: N-S Green, 1: N-S Yellow, 2: E-W Green, 3: E-W Yellow
  trafficControlled?: boolean;
  kind?: 'signal' | 'roundabout' | 't-junction';
}

export interface Building {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  roofColor: string;
  hasLights: boolean;
  neonBorderColor?: string;
}

export const WORLD_SIZE = 3600;

/** Axis-aligned box used by every placement check in this module. */
export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pointToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const projection = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + projection * dx), py - (ay + projection * dy));
};

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

const segmentsIntersect = (a: RoadPoint, b: RoadPoint, c: RoadPoint, d: RoadPoint) => {
  const d1 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d2 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  const d3 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d4 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

const segmentToSegment = (a: RoadPoint, b: RoadPoint, c: RoadPoint, d: RoadPoint) => {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegment(a.x, a.y, c.x, c.y, d.x, d.y),
    pointToSegment(b.x, b.y, c.x, c.y, d.x, d.y),
    pointToSegment(c.x, c.y, a.x, a.y, b.x, b.y),
    pointToSegment(d.x, d.y, a.x, a.y, b.x, b.y)
  );
};

/** Exact point where two open segments cross, or null when they don't. */
const segmentIntersectionPoint = (a: RoadPoint, b: RoadPoint, c: RoadPoint, d: RoadPoint): RoadPoint | null => {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom;
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * d1x, y: a.y + t * d1y };
};

/**
 * Parallel copy of a polyline, offset perpendicular to its local direction,
 * tapering from 0 at both ends up to `maxDistance` at the midpoint. Used
 * for a divided-carriageway pair that
 * has to rejoin a single node at each end (an interchange ramp and its
 * exit share the same junction nodes) while still separating in the middle
 * so the two ribbons of asphalt don't overlap.
 */
const taperedOffsetPolyline = (points: RoadPoint[], maxDistance: number): RoadPoint[] => {
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const t = cumulative[index] / total;
    const distance = maxDistance * Math.sin(Math.PI * t);
    return {
      x: point.x - (tangentY / length) * distance,
      y: point.y + (tangentX / length) * distance,
    };
  });
};

const rectContains = (rect: MapRect, x: number, y: number) =>
  Math.abs(x - rect.x) <= rect.width / 2 && Math.abs(y - rect.y) <= rect.height / 2;

/**
 * Exact distance from an axis-aligned box to a polyline. Zero when they touch.
 * Sampling the polyline was the old approach and it silently missed thin
 * diagonal crossings, so this walks the four box edges instead.
 */
export const rectToPolylineDistance = (rect: MapRect, points: RoadPoint[]) => {
  const left = rect.x - rect.width / 2;
  const right = rect.x + rect.width / 2;
  const top = rect.y - rect.height / 2;
  const bottom = rect.y + rect.height / 2;
  const corners: RoadPoint[] = [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
  ];

  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (rectContains(rect, a.x, a.y) || rectContains(rect, b.x, b.y)) return 0;
    for (let edge = 0; edge < 4; edge++) {
      best = Math.min(best, segmentToSegment(a, b, corners[edge], corners[(edge + 1) % 4]));
      if (best === 0) return 0;
    }
  }
  return best;
};

/** Sidewalk gap kept between any static object and the drivable surface. */
const SIDEWALK_APRON = 26;

/**
 * Deterministic generator. Prop layout has to be identical on every client
 * because multiplayer only syncs destructibles by id, never by position.
 */
const createRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

export class CityMap {
  public roads: RoadSegment[] = [];
  public intersections: Intersection[] = [];
  public trafficLights: TrafficLight[] = [];
  public buildings: Building[] = [];
  public decorations: MapDecoration[] = [];
  public scenicRoutes: MapTrail[] = [];
  public pois: PointOfInterest[] = [];
  public destructibles: DestructibleObject[] = [];
  public districts: CityDistrict[] = [];
  public roadNodes: RoadNetworkNode[] = [];
  public roadEdges: RoadNetworkEdge[] = [];

  private rng = createRng(0x5eed1);

  constructor() {
    this.generateLayout();
  }

  /**
   * Signed clearance from a box to a road's drivable surface. Negative means
   * the box overlaps asphalt, which for a building is a solid wall on a lane
   * and for a prop is an obstacle nobody placed on purpose.
   */
  public clearanceToRoad(rect: MapRect, road: RoadSegment) {
    return rectToPolylineDistance(rect, road.points) - road.width / 2;
  }

  /** Smallest clearance to any road. */
  public clearanceToRoads(rect: MapRect) {
    return this.roads.reduce((best, road) => Math.min(best, this.clearanceToRoad(rect, road)), Infinity);
  }

  /** True when a point sits on the drivable surface of any road. */
  public isOnRoad(x: number, y: number) {
    return this.clearanceToRoads({ x, y, width: 0, height: 0 }) < 0;
  }

  private overlapsRect(a: MapRect, b: MapRect, margin = 0) {
    return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + margin
      && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + margin;
  }

  private generateLayout() {
    // The driving controller still exposes four cardinal lanes for the
    // deterministic traffic simulation. The world itself is no longer a
    // repeated grid: these are uneven spines, while the secondary roads,
    // ring road and country routes create the actual district-to-district
    // network.
    const gridX = [520, 1320, 2200, 3040];
    const gridY = [620, 1450, 2320, 3100];

    // Districts tile the world without overlapping. They used to be six
    // free-floating rectangles, so four pairs overlapped and the map overview
    // double-painted the shared strips and stacked their labels.
    this.districts = [
      { id: 'district-port', name: 'Порт и железная дорога', kind: 'port', x: 645, y: 345, width: 1130, height: 530, color: '#164e63', accent: '#22d3ee' },
      { id: 'district-residential', name: 'Жилые кварталы', kind: 'residential', x: 645, y: 1460, width: 1130, height: 1700, color: '#155e75', accent: '#67e8f9' },
      { id: 'district-downtown', name: 'Центр', kind: 'downtown', x: 1650, y: 1460, width: 880, height: 1700, color: '#172554', accent: '#38bdf8' },
      { id: 'district-industrial', name: 'Промзона и аэропорт', kind: 'industrial', x: 2805, y: 1195, width: 1430, height: 2230, color: '#3f3f46', accent: '#f59e0b' },
      { id: 'district-nature', name: 'Лес, холмы и озеро', kind: 'nature', x: 1085, y: 2915, width: 2010, height: 1210, color: '#14532d', accent: '#86efac' },
      { id: 'district-desert', name: 'Карьерная окраина', kind: 'desert', x: 2805, y: 2915, width: 1430, height: 1210, color: '#78350f', accent: '#fbbf24' },
    ];

    const avenueNamesX = [
      'Портовая Набережная (West Way)',
      'Broadway Avenue',
      'Ленинградский Проспект',
      'Индустриальное Шоссе (East Way)',
    ];

    const avenueNamesY = [
      'Северный Обход (North Blvd)',
      'Grand Boulevard',
      'Центральный Проспект',
      'Южная Магистраль (South Blvd)',
    ];

    const road = (
      id: string,
      name: string,
      points: RoadPoint[],
      roadClass: RoadClass,
      lanesPerDirection: 1 | 2,
      speedLimit: number,
      districtId: string,
      options: Pick<RoadSegment, 'isVertical' | 'directionMode' | 'feature'>
    ): RoadSegment => ({
      id,
      name,
      x1: points[0].x,
      y1: points[0].y,
      x2: points[points.length - 1].x,
      y2: points[points.length - 1].y,
      width: lanesPerDirection === 2 ? 220 : roadClass === 'dirt' ? 48 : 92,
      lanes: lanesPerDirection * 2,
      speedLimit,
      points,
      roadClass,
      lanesPerDirection,
      districtId,
      directionMode: options.directionMode,
      isVertical: options.isVertical,
      feature: options.feature,
    });

    // Arterial spines stay on the same centerlines used by traffic AI, lane
    // markers, stop lines and traffic lights. Decorative bends belong to the
    // secondary roads; bending these four roads made the car lanes visibly
    // drift away from the geometry that drives them.
    gridX.forEach((gx, idx) => {
      const points: RoadPoint[] = [{ x: gx, y: 160 }];
      gridY.forEach((gy, crossingIndex) => {
        points.push({ x: gx, y: gy });
      });
      points.push({ x: gx, y: WORLD_SIZE - 130 });
      this.roads.push({
        ...road(`road_v_${idx}`, avenueNamesX[idx], points, 'arterial', 2, idx === 0 ? 50 : 60, idx < 2 ? 'district-residential' : 'district-industrial', {
          isVertical: true,
          directionMode: 'two-way',
        }),
      });
    });

    gridY.forEach((gy, idy) => {
      const points: RoadPoint[] = [{ x: 140, y: gy }];
      gridX.forEach((gx, crossingIndex) => {
        points.push({ x: gx, y: gy });
      });
      points.push({ x: WORLD_SIZE - 120, y: gy });
      this.roads.push({
        ...road(`road_h_${idy}`, avenueNamesY[idy], points, 'arterial', 2, idy === 0 ? 50 : 60, idy < 2 ? 'district-downtown' : 'district-desert', {
          isVertical: false,
          directionMode: idy === 1 ? 'one-way' : 'two-way',
        }),
      });
    });

    this.roads.push(
      road('road-ring-north', 'Северное кольцо', [
        { x: 520, y: 620 }, { x: 760, y: 360 }, { x: 1420, y: 250 },
        { x: 2290, y: 340 }, { x: 3040, y: 620 },
      ], 'highway', 2, 80, 'district-downtown', { isVertical: false, directionMode: 'two-way', feature: 'bridge' }),
      road('road-ring-south', 'Южное кольцо', [
        { x: 520, y: 2320 }, { x: 760, y: 2670 }, { x: 1440, y: 2810 },
        { x: 2260, y: 2740 }, { x: 3040, y: 2320 },
      ], 'highway', 2, 80, 'district-desert', { isVertical: false, directionMode: 'two-way', feature: 'tunnel' }),
      // The ramp and the exit used to be two independently hand-drawn curves
      // that both had to start/end at the same two junctions; their waypoints
      // wandered within 74-134px of each other while each carriageway's
      // painted halo reaches ~70px from its own centerline, so the two
      // ribbons of asphalt overlapped along most of the interchange.
      // Deriving both from one shared centerline, offset apart only in the
      // middle and tapering back to 0 at the shared junction nodes, keeps
      // them a guaranteed-parallel 180px apart mid-span while still meeting
      // the graph nodes exactly at both ends. The east end lands exactly on
      // road_v_3's centerline (x=3040) instead of 60px past it — the old
      // endpoint left the ramp/exit crossing that arterial with no junction
      // at all, the same "roads just overlap" look this rewrite exists to fix.
      ...(() => {
        const interchangeCenterline: RoadPoint[] = [
          { x: 2200, y: 1450 }, { x: 2500, y: 1340 }, { x: 2820, y: 1260 }, { x: 3040, y: 1180 },
        ];
        const rampPoints = taperedOffsetPolyline(interchangeCenterline, 90);
        const exitPoints = taperedOffsetPolyline([...interchangeCenterline].reverse(), 90);
        return [
          road('road-airport-ramp', 'Развязка к аэропорту', rampPoints, 'highway', 1, 70, 'district-industrial', { isVertical: false, directionMode: 'one-way', feature: 'ramp' }),
          road('road-airport-exit', 'Съезд из аэропорта', exitPoints, 'highway', 1, 70, 'district-industrial', { isVertical: false, directionMode: 'one-way', feature: 'ramp' }),
        ];
      })(),
      road('road-port-access', 'Портовый проезд', [
        { x: 140, y: 620 }, { x: 330, y: 790 }, { x: 720, y: 820 }, { x: 980, y: 700 },
      ], 'service', 1, 35, 'district-port', { isVertical: false, directionMode: 'two-way', feature: 'rail_crossing' }),
      road('road-winding-country', 'Загородная извилистая', [
        { x: 820, y: 3050 }, { x: 650, y: 3260 }, { x: 790, y: 3440 }, { x: 1180, y: 3510 },
        { x: 1480, y: 3370 }, { x: 1740, y: 3500 }, { x: 2120, y: 3380 }, { x: 2420, y: 3500 },
      ], 'dirt', 1, 28, 'district-nature', { isVertical: false, directionMode: 'two-way', feature: 'winding' }),
      // Runs between Broadway and Ленинградский, in the gap north of the
      // construction site. As a floating stub it could never appear in a
      // route, because the graph only links roads whose endpoints touch the
      // network, and its old line cut straight through two POI zones.
      road('road-market-one-way', 'Рыночный переулок', [
        { x: 1320, y: 800 }, { x: 1560, y: 790 }, { x: 1800, y: 800 }, { x: 2200, y: 820 },
      ], 'street', 1, 35, 'district-downtown', { isVertical: false, directionMode: 'one-way', feature: 'roundabout' }),
      road('road-quarry-service', 'Карьерная объездная', [
        { x: 2500, y: 3000 }, { x: 2800, y: 2860 }, { x: 3240, y: 2920 }, { x: 3480, y: 3180 },
      ], 'service', 1, 40, 'district-desert', { isVertical: false, directionMode: 'two-way' }),

      // Driveways for POIs that generateCityBlocks() otherwise buries in the
      // interior of a city block. Building placement already respects any
      // road pushed onto this.roads before generateCityBlocks() runs, so
      // these carve a guaranteed clear, paved approach the same way the
      // market/port/quarry connectors already do for their own POIs.
      // The near-POI endpoint sits half the driveway's own width plus a
      // small verge back from the POI footprint — flush against it would
      // let the driveway's asphalt (a 46px-radius centerline for a
      // 'service' road) overlap the POI's paved yard by that same 46px.
      // Each one's arterial-side endpoint continues past the arterial's
      // centerline to its far curb (+110, an arterial's half-width) instead
      // of stopping dead in the middle of it — ending on the centerline left
      // the road's rounded cap sitting like a blob in the middle of a lane,
      // rather than a driveway that visibly crosses the near lanes and lands
      // on the far curb the way a real T-junction apron does. The routing
      // node stays on the centerline; only the drawn pavement is longer.
      road('road-depot-access', 'Подъезд к автобазе КАМАЗ', [
        { x: 1224, y: 1000 }, { x: 1320, y: 1000 }, { x: 1430, y: 1000 },
      ], 'service', 1, 25, 'district-residential', { isVertical: false, directionMode: 'two-way' }),
      road('road-construction-access', 'Подъезд к стройплощадке', [
        { x: 1835, y: 1347 }, { x: 1835, y: 1450 }, { x: 1835, y: 1560 },
      ], 'service', 1, 25, 'district-downtown', { isVertical: true, directionMode: 'two-way' }),
      road('road-hospital-access', 'Подъезд к больнице', [
        { x: 1204, y: 1800 }, { x: 1320, y: 1800 }, { x: 1430, y: 1800 },
      ], 'service', 1, 25, 'district-residential', { isVertical: false, directionMode: 'two-way' }),
      road('road-police-access', 'Подъезд к управлению ДПС', [
        { x: 2600, y: 1626 }, { x: 2600, y: 1450 }, { x: 2600, y: 1340 },
      ], 'service', 1, 25, 'district-downtown', { isVertical: true, directionMode: 'two-way' }),
      road('road-gas-station-access', 'Подъезд к АЗС', [
        { x: 1800, y: 1636 }, { x: 1800, y: 1450 }, { x: 1800, y: 1340 },
      ], 'service', 1, 25, 'district-downtown', { isVertical: true, directionMode: 'two-way' }),
      road('road-warehouse-access', 'Подъезд к складу Wildbox', [
        { x: 2546, y: 2264 }, { x: 2546, y: 2320 }, { x: 2546, y: 2430 },
      ], 'service', 1, 25, 'district-industrial', { isVertical: true, directionMode: 'two-way' }),
      road('road-camp-access', 'Грунтовый подъезд к лагерю', [
        { x: 240, y: 3000 }, { x: 240, y: 3100 }, { x: 240, y: 3210 },
      ], 'dirt', 1, 20, 'district-nature', { isVertical: true, directionMode: 'two-way' }),
    );

    // Create Intersections and Traffic Lights at Grid Crossings
    gridX.forEach((gx, ix) => {
      gridY.forEach((gy, iy) => {
        const interId = `inter_${ix}_${iy}`;
        const interName = `${avenueNamesX[ix]} & ${avenueNamesY[iy]}`;

        this.intersections.push({
          id: interId,
          name: interName,
          x: gx,
          y: gy,
          // The box has to cover the carriageways that meet here; at 140 it
          // was narrower than the 220px arterials and the painted junction
          // stopped short of the asphalt it belongs to.
          size: ix === 1 && iy === 1 ? 260 : 230,
          timer: (ix * 3 + iy * 2) % 12, // staggered timers
          phase: (ix + iy) % 4,
        });

        // 4 Traffic lights per intersection
        this.trafficLights.push(
          {
            id: `tl_${interId}_n`,
            x: gx - 60,
            y: gy - 75,
            intersectionId: interId,
            direction: 'north',
            state: 'red',
            pedestrianState: 'dont_walk',
          },
          {
            id: `tl_${interId}_s`,
            x: gx + 60,
            y: gy + 75,
            intersectionId: interId,
            direction: 'south',
            state: 'red',
            pedestrianState: 'dont_walk',
          },
          {
            id: `tl_${interId}_w`,
            x: gx - 75,
            y: gy + 60,
            intersectionId: interId,
            direction: 'west',
            state: 'green',
            pedestrianState: 'walk',
          },
          {
            id: `tl_${interId}_e`,
            x: gx + 75,
            y: gy - 60,
            intersectionId: interId,
            direction: 'east',
            state: 'green',
            pedestrianState: 'walk',
          }
        );
      });
    });

    // Add a small roundabout and T-junctions as first-class landmarks. The
    // existing light controller can ignore these while the map and graph use
    // them as proper routing nodes.
    this.intersections.push(
      { id: 'inter_roundabout_market', name: 'Круговое движение у рынка', x: 1800, y: 800, size: 130, timer: 0, phase: 2, trafficControlled: false },
      { id: 'inter_t_port', name: 'Т-перекрёсток у порта', x: 720, y: 820, size: 110, timer: 3, phase: 0, trafficControlled: false },
      { id: 'inter_t_quarry', name: 'Т-перекрёсток у карьера', x: 2800, y: 2860, size: 110, timer: 6, phase: 2, trafficControlled: false },
    );

    // 2. Points of Interest (POIs) with special functional zones
    this.pois = [
      {
        id: 'poi_depot',
        name: 'KAMAZ Truck Depot',
        nameRu: 'Главная Автобаза КАМАЗ',
        type: 'depot',
        x: 1000,
        y: 1000,
        width: 320,
        height: 240,
        color: '#f97316',
        icon: 'Truck',
        description: 'Центральный гараж и стоянка грузовиков. Здесь берутся главные заказы на рейсы.',
      },
      {
        id: 'poi_construction',
        name: 'Monolith Construction Site',
        nameRu: 'Стройплощадка «Монолит»',
        type: 'construction',
        x: 1835,
        y: 1166,
        width: 306,
        height: 234,
        color: '#eab308',
        icon: 'HardHat',
        description: 'Строящийся жилой комплекс. Требуются постоянные поставки бетона, кирпича и балок.',
      },
      {
        id: 'poi_port',
        name: 'Commercial Cargo Harbor',
        nameRu: 'Грузовой Морской Порт',
        type: 'port',
        x: 220,
        y: 1800,
        width: 300,
        height: 380,
        color: '#0284c7',
        icon: 'Anchor',
        description: 'Морские контейнеры, портовые краны и тяжёлое импортное оборудование для доставки в город.',
      },
      {
        id: 'poi_quarry',
        name: 'Sand & Gravel Quarry',
        nameRu: 'Песчаный Карьер и ГОК',
        type: 'quarry',
        x: 3340,
        y: 1800,
        width: 300,
        height: 380,
        color: '#d97706',
        icon: 'Mountain',
        description: 'Добыча гравия, песка и щебня. Идеальное место для загрузки самосвала КАМАЗ.',
      },
      {
        id: 'poi_hospital',
        name: 'City Central Hospital',
        nameRu: 'Центральная Больница №1',
        type: 'hospital',
        x: 1000,
        y: 1800,
        width: 280,
        height: 220,
        color: '#ef4444',
        icon: 'HeartPulse',
        description: 'Городская клиническая больница со станцией Скорой Помощи.',
      },
      {
        id: 'poi_police',
        name: 'Police Precinct & Patrol HQ',
        nameRu: 'Управление ДПС и Полиции',
        type: 'police',
        x: 2600,
        y: 1800,
        width: 280,
        height: 220,
        color: '#3b82f6',
        icon: 'Shield',
        description: 'Дежурная часть ДПС, патрульные экипажи и штрафстоянка.',
      },
      {
        id: 'poi_workshop',
        name: 'City Auto Workshop & Tuning',
        nameRu: 'Автосервис и Тюнинг Гараж',
        type: 'workshop',
        x: 1775,
        y: 2557,
        width: 216,
        height: 173,
        color: '#10b981',
        icon: 'Wrench',
        description: 'Бесплатный ремонт, покраска, замена колёс и выбор любого авто из автопарка!',
      },
      {
        id: 'poi_gas_station',
        name: 'Mega Fuel Station',
        nameRu: 'АЗС «РосНефть»',
        type: 'gas_station',
        x: 1800,
        y: 1800,
        width: 240,
        height: 200,
        color: '#06b6d4',
        icon: 'Fuel',
        description: 'Круглосуточная заправочная станция, кафе и магазин автотоваров.',
      },
      {
        id: 'poi_warehouse',
        name: 'Mega Logistics Center',
        nameRu: 'Логистический Склад Wildbox',
        type: 'warehouse',
        x: 2546,
        y: 2083,
        width: 288,
        height: 234,
        color: '#8b5cf6',
        icon: 'Package',
        description: 'Автоматизированный логистический хаб. Срочные экспресс-доставки товаров.',
      },
      {
        id: 'poi_airport',
        name: 'North Cargo Airport',
        nameRu: 'Грузовой аэропорт «Северный»',
        type: 'airport',
        x: 2712,
        y: 950,
        width: 420,
        height: 250,
        color: '#38bdf8',
        icon: 'Plane',
        description: 'Грузовой терминал, взлётная полоса и быстрые межрайонные рейсы.',
      },
      {
        id: 'poi_rail_terminal',
        name: 'East Rail Freight Terminal',
        nameRu: 'Железнодорожный грузовой терминал',
        type: 'rail_terminal',
        x: 232,
        y: 383,
        width: 324,
        height: 162,
        color: '#a78bfa',
        icon: 'TrainFront',
        description: 'Перегрузка контейнеров между вагонами и грузовиками.',
      },
      {
        id: 'poi_truck_stop',
        name: 'Dusty Mile Truck Stop',
        nameRu: 'Придорожный мотель и стоянка',
        type: 'truck_stop',
        x: 3340,
        y: 2723,
        width: 300,
        height: 220,
        color: '#f59e0b',
        icon: 'Coffee',
        description: 'АЗС, мотель, весы и безопасная стоянка для дальнобойщиков.',
      },
      {
        id: 'poi_market',
        name: 'Central Freight Market',
        nameRu: 'Центральный грузовой рынок',
        type: 'market',
        x: 1792,
        y: 947,
        width: 216,
        height: 158,
        color: '#facc15',
        icon: 'Store',
        description: 'Городской рынок с короткими маршрутами, погрузочными карманами и круговым движением.',
      },
      {
        id: 'poi_lookout',
        name: 'Pine Ridge Lookout',
        nameRu: 'Смотровая площадка «Сосновый кряж»',
        type: 'lookout',
        x: 941,
        y: 3308,
        width: 220,
        height: 180,
        color: '#86efac',
        icon: 'Mountain',
        description: 'Высокая точка над лесом и озером, к которой ведёт извилистая дорога.',
      },
      {
        id: 'poi_camp',
        name: 'Lakeside Camp',
        nameRu: 'Лесной лагерь у озера',
        type: 'camp',
        x: 240,
        y: 2866,
        width: 260,
        height: 190,
        color: '#22c55e',
        icon: 'TentTree',
        description: 'Тихая природная зона с грунтовым подъездом и небольшим складом.',
      },
    ];

    // 3. City Blocks & Buildings (Filling blocks between roads)
    this.generateCityBlocks();

    // 4. Parks, water and industrial yards keep the city from becoming a
    // uniform grid of identical crossroads.
    this.generateMapDecorations();
    this.generateScenicRoutes();
    this.assignRoadDistricts();
    this.buildRoadNetwork();
    this.computeGradeCrossings();

    // 5. Destructibles (Crates, cones, lamps, hydrants, fences, trash cans)
    this.generateDestructibles();
  }

  /**
   * Records where each bridge/tunnel road crosses another road at grade, so
   * the renderer can draw pier shadows (bridge) or portal mouths (tunnel)
   * there instead of just stacking two flat, painted carriageways on top of
   * each other with no visual cue that one of them is actually elevated or
   * sunken.
   */
  private computeGradeCrossings() {
    this.roads.forEach((road) => {
      if (road.feature !== 'bridge' && road.feature !== 'tunnel') return;
      const crossings: RoadPoint[] = [];
      this.roads.forEach((other) => {
        if (other.id === road.id) return;
        for (let i = 1; i < road.points.length; i++) {
          for (let j = 1; j < other.points.length; j++) {
            const point = segmentIntersectionPoint(road.points[i - 1], road.points[i], other.points[j - 1], other.points[j]);
            if (point) crossings.push(point);
          }
        }
      });
      road.gradeCrossings = crossings;
    });
  }

  /**
   * districtId was hand-written per road, so full-world spines were labelled
   * with whatever district happened to be typed next to them. Deriving it from
   * the centerline midpoint keeps the label meaningful as roads move.
   */
  private assignRoadDistricts() {
    this.roads.forEach((road) => {
      const mid = road.points[Math.floor(road.points.length / 2)];
      const district = this.districts.find((candidate) =>
        Math.abs(mid.x - candidate.x) <= candidate.width / 2 && Math.abs(mid.y - candidate.y) <= candidate.height / 2);
      if (district) road.districtId = district.id;
    });
  }

  /**
   * Lightweight deterministic road graph used by missions and traffic route
   * selection. Geometry remains render-friendly polylines, while this graph
   * gives every major district a stable alternative route.
   */
  private buildRoadNetwork() {
    const gridX = [520, 1320, 2200, 3040];
    const gridY = [620, 1450, 2320, 3100];
    this.roadNodes = gridY.flatMap((y, iy) => gridX.map((x, ix) => ({
      id: `node-grid-${ix}-${iy}`,
      x,
      y,
      kind: 'junction' as const,
    })));
    // Sits exactly on road_v_3 (x=3040) now, so it doubles as the junction
    // where the interchange actually meets that arterial instead of
    // crossing it 60px further east with no node at all.
    this.roadNodes.push({ id: 'node-airport', x: 3040, y: 1180, kind: 'junction' });

    // Junctions where the secondary roads meet the arterials. Without these the
    // port access, the market street, the country route and the quarry bypass
    // are drawn and driveable but invisible to missions and NPC routing.
    this.roadNodes.push(
      { id: 'node-port-west', x: 140, y: 620, kind: 'terminal' },
      { id: 'node-port-east', x: 980, y: 700, kind: 'junction' },
      { id: 'node-market-in', x: 1320, y: 800, kind: 'junction' },
      { id: 'node-market-out', x: 2200, y: 820, kind: 'junction' },
      { id: 'node-country-west', x: 820, y: 3050, kind: 'junction' },
      // Despite the old name this is the winding road's far (east) end near
      // the quarry bypass, not a stop by the actual Pine Ridge lookout — that
      // POI already sits directly on Южная Магистраль (road_h_3) instead.
      { id: 'node-country-quarry-link', x: 2420, y: 3500, kind: 'terminal' },
      { id: 'node-quarry-west', x: 2500, y: 3000, kind: 'junction' },
      { id: 'node-quarry-east', x: 3480, y: 3180, kind: 'terminal' },
    );

    // Driveways that otherwise dead-end mid-block, linked the same way the
    // market/port/quarry connectors splice into their parent arterial: a
    // junction node on the arterial plus a short spur to a node at the POI.
    this.roadNodes.push(
      { id: 'node-depot', x: 1224, y: 1000, kind: 'terminal' },
      { id: 'node-depot-junction', x: 1320, y: 1000, kind: 'junction' },
      { id: 'node-construction', x: 1835, y: 1347, kind: 'terminal' },
      { id: 'node-construction-junction', x: 1835, y: 1450, kind: 'junction' },
      { id: 'node-hospital', x: 1204, y: 1800, kind: 'terminal' },
      { id: 'node-hospital-junction', x: 1320, y: 1800, kind: 'junction' },
      { id: 'node-police', x: 2600, y: 1626, kind: 'terminal' },
      { id: 'node-police-junction', x: 2600, y: 1450, kind: 'junction' },
      { id: 'node-gas-station', x: 1800, y: 1636, kind: 'terminal' },
      { id: 'node-gas-station-junction', x: 1800, y: 1450, kind: 'junction' },
      { id: 'node-warehouse', x: 2546, y: 2264, kind: 'terminal' },
      { id: 'node-warehouse-junction', x: 2546, y: 2320, kind: 'junction' },
      { id: 'node-camp', x: 240, y: 3000, kind: 'terminal' },
      { id: 'node-camp-junction', x: 240, y: 3100, kind: 'junction' },
    );

    const lengthBetween = (a: RoadNetworkNode, b: RoadNetworkNode) => Math.hypot(b.x - a.x, b.y - a.y);
    const nodes = new Map(this.roadNodes.map((node) => [node.id, node]));
    const edges: RoadNetworkEdge[] = [];
    const link = (from: string, to: string, roadId: string) => {
      const a = nodes.get(from);
      const b = nodes.get(to);
      if (!a || !b) return;
      const road = this.roads.find((candidate) => candidate.id === roadId);
      if (!road) return;
      const oneWay = road.directionMode === 'one-way';
      edges.push({ id: `${roadId}:${from}>${to}`, from, to, roadId, length: lengthBetween(a, b), speedLimit: road.speedLimit, oneWay });
      if (!oneWay) {
        edges.push({ id: `${roadId}:${to}>${from}`, from: to, to: from, roadId, length: lengthBetween(a, b), speedLimit: road.speedLimit, oneWay: false });
      }
    };

    gridY.forEach((_y, iy) => {
      for (let ix = 0; ix < gridX.length - 1; ix++) link(`node-grid-${ix}-${iy}`, `node-grid-${ix + 1}-${iy}`, `road_h_${iy}`);
    });
    gridX.forEach((_x, ix) => {
      for (let iy = 0; iy < gridY.length - 1; iy++) link(`node-grid-${ix}-${iy}`, `node-grid-${ix}-${iy + 1}`, `road_v_${ix}`);
    });
    link('node-grid-0-0', 'node-grid-3-0', 'road-ring-north');
    link('node-grid-0-2', 'node-grid-3-2', 'road-ring-south');
    link('node-grid-2-1', 'node-airport', 'road-airport-ramp');
    link('node-airport', 'node-grid-2-1', 'road-airport-exit');
    link('node-grid-3-0', 'node-airport', 'road_v_3');
    link('node-airport', 'node-grid-3-1', 'road_v_3');

    // Port loop off the northern boulevard.
    link('node-port-west', 'node-port-east', 'road-port-access');
    link('node-port-west', 'node-grid-0-0', 'road_h_0');
    link('node-grid-0-0', 'node-port-east', 'road_h_0');

    // One-way market street from Broadway down to Grand Boulevard.
    link('node-market-in', 'node-market-out', 'road-market-one-way');
    link('node-grid-1-0', 'node-market-in', 'road_v_1');
    link('node-market-in', 'node-grid-1-1', 'road_v_1');
    link('node-grid-2-0', 'node-market-out', 'road_v_2');
    link('node-market-out', 'node-grid-2-1', 'road_v_2');

    // Country route to the quarry bypass, and the quarry bypass loop.
    link('node-country-west', 'node-country-quarry-link', 'road-winding-country');
    link('node-grid-0-3', 'node-country-west', 'road_h_3');
    link('node-country-west', 'node-grid-1-3', 'road_h_3');
    link('node-grid-2-3', 'node-quarry-west', 'road_h_3');
    link('node-quarry-west', 'node-quarry-east', 'road-quarry-service');
    link('node-grid-3-3', 'node-quarry-east', 'road_h_3');

    // POI driveways: a spur to the building plus the sub-links that splice
    // its junction into the parent arterial.
    link('node-depot', 'node-depot-junction', 'road-depot-access');
    link('node-grid-1-0', 'node-depot-junction', 'road_v_1');
    link('node-depot-junction', 'node-grid-1-1', 'road_v_1');

    link('node-construction', 'node-construction-junction', 'road-construction-access');
    link('node-grid-1-1', 'node-construction-junction', 'road_h_1');
    link('node-construction-junction', 'node-grid-2-1', 'road_h_1');

    link('node-hospital', 'node-hospital-junction', 'road-hospital-access');
    link('node-grid-1-1', 'node-hospital-junction', 'road_v_1');
    link('node-hospital-junction', 'node-grid-1-2', 'road_v_1');

    link('node-police', 'node-police-junction', 'road-police-access');
    link('node-grid-2-1', 'node-police-junction', 'road_h_1');
    link('node-police-junction', 'node-grid-3-1', 'road_h_1');

    link('node-gas-station', 'node-gas-station-junction', 'road-gas-station-access');
    link('node-grid-1-1', 'node-gas-station-junction', 'road_h_1');
    link('node-gas-station-junction', 'node-grid-2-1', 'road_h_1');

    link('node-warehouse', 'node-warehouse-junction', 'road-warehouse-access');
    link('node-grid-2-2', 'node-warehouse-junction', 'road_h_2');
    link('node-warehouse-junction', 'node-grid-3-2', 'road_h_2');

    link('node-camp', 'node-camp-junction', 'road-camp-access');
    link('node-camp-junction', 'node-grid-0-3', 'road_h_3');

    this.roadEdges = edges;
  }

  private nearestNetworkNode(poi: PointOfInterest) {
    return this.roadNodes.reduce((nearest, node) => {
      const distance = Math.hypot(node.x - poi.x, node.y - poi.y);
      return distance < nearest.distance ? { node, distance } : nearest;
    }, { node: this.roadNodes[0], distance: Infinity });
  }

  /** Return a deterministic A* route as road IDs, optionally avoiding blocked roads. */
  public getRouteBetweenPois(
    sourcePoiId: string,
    targetPoiId: string,
    blockedRoadIds: string[] = [],
    dynamicCost?: (edge: RoadNetworkEdge) => number
  ) {
    const source = this.pois.find((poi) => poi.id === sourcePoiId);
    const target = this.pois.find((poi) => poi.id === targetPoiId);
    if (!source || !target || this.roadNodes.length === 0) return [];
    const start = this.nearestNetworkNode(source).node.id;
    const goal = this.nearestNetworkNode(target).node.id;
    const blocked = new Set(blockedRoadIds);
    const open = new Set([start]);
    const cameFrom = new Map<string, { node: string; roadId: string }>();
    const gScore = new Map<string, number>([[start, 0]]);
    const fScore = new Map<string, number>([[start, 0]]);
    const heuristic = (nodeId: string) => {
      const node = this.roadNodes.find((candidate) => candidate.id === nodeId)!;
      const destination = this.roadNodes.find((candidate) => candidate.id === goal)!;
      return Math.hypot(destination.x - node.x, destination.y - node.y);
    };

    while (open.size > 0) {
      const current = [...open].sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity))[0];
      if (current === goal) {
        const result: string[] = [];
        let cursor = goal;
        while (cameFrom.has(cursor)) {
          const step = cameFrom.get(cursor)!;
          result.unshift(step.roadId);
          cursor = step.node;
        }
        return result;
      }
      open.delete(current);
      for (const edge of this.roadEdges.filter((candidate) => candidate.from === current && !blocked.has(candidate.roadId))) {
        const trafficPenalty = Math.max(0, dynamicCost?.(edge) ?? 0);
        const tentative = (gScore.get(current) ?? Infinity) + edge.length * (1 + 60 / Math.max(edge.speedLimit, 1)) + trafficPenalty;
        if (tentative >= (gScore.get(edge.to) ?? Infinity)) continue;
        cameFrom.set(edge.to, { node: current, roadId: edge.roadId });
        gScore.set(edge.to, tentative);
        fScore.set(edge.to, tentative + heuristic(edge.to));
        open.add(edge.to);
      }
    }
    return [];
  }

  /**
   * Lane centers on a road, offset perpendicular to the local centerline.
   * Passing `at` picks the nearest point on the polyline; without it the road
   * start is used. The offsets used to be applied to road.x1/road.y1 alone, so
   * a bend in the polyline was ignored and every lane center reported the same
   * point at the road's first vertex.
   */
  public getLaneCenters(roadId: string, direction: 'north' | 'south' | 'east' | 'west', at?: RoadPoint) {
    const road = this.roads.find((candidate) => candidate.id === roadId);
    if (!road) return [];
    if (road.directionMode === 'one-way') {
      const dx = road.x2 - road.x1;
      const dy = road.y2 - road.y1;
      const allowedDirection = Math.abs(dx) >= Math.abs(dy)
        ? (dx >= 0 ? 'east' : 'west')
        : (dy >= 0 ? 'south' : 'north');
      if (direction !== allowedDirection) return [];
    }

    let anchor: RoadPoint = road.points[0];
    let tangent: RoadPoint = { x: road.points[1].x - road.points[0].x, y: road.points[1].y - road.points[0].y };
    if (at) {
      let best = Infinity;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSquared));
        const point = { x: a.x + t * dx, y: a.y + t * dy };
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (distance < best) {
          best = distance;
          anchor = point;
          tangent = { x: dx, y: dy };
        }
      }
    }

    // Right-hand traffic: the driving side is to the right of the travel
    // heading, so vertical roads offset in x and horizontal roads in y.
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const normalX = -tangent.y / length;
    const normalY = tangent.x / length;
    const sign = road.isVertical
      ? (direction === 'south' ? 1 : -1) * (normalX >= 0 ? 1 : -1)
      : (direction === 'east' ? 1 : -1) * (normalY >= 0 ? 1 : -1);

    return Array.from({ length: road.lanesPerDirection }, (_, lane) => {
      const offset = (34 + lane * 54) * sign;
      return { x: anchor.x + normalX * offset, y: anchor.y + normalY * offset };
    });
  }

  private generateCityBlocks() {
    // City blocks are derived from the road network instead of being listed by
    // hand. Hand-placed rectangles drifted out of sync every time a road moved:
    // most of them ended up centred on asphalt, so the placement filter culled
    // them and whole districts came out empty.
    const spineX = [520, 1320, 2200, 3040];
    const spineY = [620, 1450, 2320, 3100];
    const WORLD_MARGIN = 120;
    const ARTERIAL_HALF = 110;
    const BLOCK_INSET = ARTERIAL_HALF + SIDEWALK_APRON + 16;

    const lanesX = [WORLD_MARGIN, ...spineX, WORLD_SIZE - WORLD_MARGIN];
    const lanesY = [WORLD_MARGIN, ...spineY, WORLD_SIZE - WORLD_MARGIN];

    const buildingColors = [
      { base: '#0f172a', roof: '#1e293b', neon: '#38bdf8' },
      { base: '#111827', roof: '#1f2937', neon: '#fbbf24' },
      { base: '#18181b', roof: '#27272a', neon: '#34d399' },
      { base: '#090d16', roof: '#172033', neon: '#f43f5e' },
      { base: '#141e33', roof: '#1e2942', neon: '#a855f7' },
    ];

    const districtAt = (x: number, y: number) => this.districts.find((district) =>
      Math.abs(x - district.x) <= district.width / 2 && Math.abs(y - district.y) <= district.height / 2);

    let bId = 0;
    for (let cx = 0; cx < lanesX.length - 1; cx++) {
      for (let cy = 0; cy < lanesY.length - 1; cy++) {
        const insetLeft = cx === 0 ? 0 : BLOCK_INSET;
        const insetRight = cx === lanesX.length - 2 ? 0 : BLOCK_INSET;
        const insetTop = cy === 0 ? 0 : BLOCK_INSET;
        const insetBottom = cy === lanesY.length - 2 ? 0 : BLOCK_INSET;

        const minX = lanesX[cx] + insetLeft;
        const maxX = lanesX[cx + 1] - insetRight;
        const minY = lanesY[cy] + insetTop;
        const maxY = lanesY[cy + 1] - insetBottom;
        const blockW = maxX - minX;
        const blockH = maxY - minY;
        if (blockW < 150 || blockH < 150) continue;

        // Downtown gets a tighter, taller grain than the outskirts, which keeps
        // the GTA-style contrast the districts are meant to communicate.
        const kind = districtAt((minX + maxX) / 2, (minY + maxY) / 2)?.kind;
        // Keep the grain fine enough that a single connector road crossing a
        // block only costs the footprints it actually touches, not the block.
        const grain = kind === 'downtown' ? 140 : kind === 'residential' ? 165 : kind === 'industrial' ? 205 : 185;
        const gap = kind === 'downtown' ? 26 : 34;
        const countX = Math.max(1, Math.min(6, Math.ceil(blockW / grain)));
        const countY = Math.max(1, Math.min(6, Math.ceil(blockH / grain)));
        const stepW = blockW / countX;
        const stepH = blockH / countY;

        for (let bx = 0; bx < countX; bx++) {
          for (let by = 0; by < countY; by++) {
            const bw = stepW - gap;
            const bh = stepH - gap;
            if (bw < 46 || bh < 46) continue;

            const px = minX + bx * stepW + stepW / 2;
            const py = minY + by * stepH + stepH / 2;
            const footprint: MapRect = { x: px, y: py, width: bw, height: bh };

            // Leave a sidewalk apron beside every driveable corridor. A building
            // must never become an invisible collision on an NPC lane, and the
            // footprint has to be measured against the real polyline: comparing
            // a single axis against isolated vertices treats every road as an
            // infinite line and culls blocks that are far clear of any asphalt.
            if (this.clearanceToRoads(footprint) < SIDEWALK_APRON) continue;

            // Buildings are solid AABB colliders, so one inside a POI would wall
            // off a loading zone the missions expect to be driveable.
            if (this.pois.some((poi) => this.overlapsRect(footprint, poi, 24))) continue;
            if (this.decorations.some((zone) => zone.type === 'water' && this.overlapsRect(footprint, zone))) continue;
            if (this.buildings.some((other) => this.overlapsRect(footprint, other))) continue;

            const theme = buildingColors[(cx * 3 + cy * 2 + bx + by) % buildingColors.length];
            this.buildings.push({
              id: `b_${bId++}`,
              x: px,
              y: py,
              width: bw,
              height: bh,
              color: theme.base,
              roofColor: theme.roof,
              hasLights: true,
              neonBorderColor: theme.neon,
            });
          }
        }
      }
    }
  }

  private generateMapDecorations() {
    this.decorations = [
      {
        id: 'zone_lake_district',
        type: 'water',
        x: 310,
        y: 310,
        width: 270,
        height: 240,
        label: 'Озёрный район',
      },
      {
        id: 'zone_central_park',
        type: 'park',
        x: 2600,
        y: 1000,
        width: 430,
        height: 350,
        label: 'Центральный парк',
      },
      {
        id: 'zone_forest_promenade',
        type: 'forest',
        x: 310,
        y: 2600,
        width: 270,
        height: 380,
        label: 'Лесная аллея',
      },
      {
        id: 'zone_industrial_yard',
        type: 'industrial',
        x: 1800,
        y: 3300,
        width: 430,
        height: 260,
        label: 'Промышленный двор',
      },
      {
        id: 'zone_logistics_plaza',
        type: 'plaza',
        x: 3290,
        y: 310,
        width: 250,
        height: 230,
        label: 'Транспортная площадь',
      },
      {
        id: 'zone_downtown_blocks',
        type: 'plaza',
        x: 1600,
        y: 1300,
        width: 820,
        height: 600,
        label: 'Деловой центр и рынок',
      },
      {
        id: 'zone_desert_flats',
        type: 'desert',
        x: 3000,
        y: 3050,
        width: 1100,
        height: 760,
        label: 'Пустынная окраина',
      },
      {
        id: 'zone_pine_hills',
        type: 'hills',
        x: 1500,
        y: 3200,
        width: 1450,
        height: 720,
        label: 'Холмы и сосновый лес',
      },
      {
        id: 'zone_rail_corridor',
        type: 'rail',
        x: 800,
        y: 383,
        width: 1250,
        height: 70,
        label: 'Железнодорожный коридор',
      },
      {
        id: 'zone_airport_runway',
        type: 'airport',
        x: 2760,
        y: 700,
        width: 820,
        height: 230,
        label: 'ВПП грузового аэропорта',
      },
    ];
  }

  private generateScenicRoutes() {
    this.scenicRoutes = [
      {
        id: 'trail-lake-loop',
        label: 'Озёрная грунтовка',
        points: [
          { x: 150, y: 590 },
          { x: 250, y: 575 },
          { x: 500, y: 590 },
          { x: 545, y: 720 },
          { x: 500, y: 820 },
        ],
      },
      {
        id: 'trail-park-loop',
        label: 'Парковая дорожка',
        points: [
          { x: 2420, y: 900 },
          { x: 2560, y: 820 },
          { x: 2920, y: 870 },
          { x: 3070, y: 1040 },
          { x: 2910, y: 1260 },
          { x: 2580, y: 1300 },
        ],
      },
      {
        id: 'trail-forest-promenade',
        label: 'Лесная дорожка',
        points: [
          { x: 170, y: 2450 },
          { x: 280, y: 2380 },
          { x: 500, y: 2440 },
          { x: 520, y: 2720 },
          { x: 360, y: 2980 },
          { x: 180, y: 2900 },
        ],
      },
      {
        id: 'trail-industrial-access',
        label: 'Служебный проезд',
        points: [
          { x: 1510, y: 3220 },
          { x: 1700, y: 3150 },
          { x: 2150, y: 3160 },
          { x: 2310, y: 3300 },
          { x: 2180, y: 3450 },
        ],
      },
    ];
  }

  /**
   * True when a footprint is clear of asphalt, buildings and other props.
   * Every prop goes through this: a barrel welded into a wall is unreachable
   * and a cone on a lane is an obstacle nobody placed on purpose.
   */
  private isFreeGround(rect: MapRect, apron = SIDEWALK_APRON) {
    if (rect.x < 40 || rect.y < 40 || rect.x > WORLD_SIZE - 40 || rect.y > WORLD_SIZE - 40) return false;
    if (this.clearanceToRoads(rect) < apron) return false;
    if (this.buildings.some((building) => this.overlapsRect(rect, building, 6))) return false;
    return !this.destructibles.some((prop) => this.overlapsRect(rect, prop, 8));
  }

  /** Nearest free spot to an anchor, searched on a deterministic spiral. */
  private findFreeGround(x: number, y: number, size: number, spread: number, apron = SIDEWALK_APRON) {
    for (let attempt = 0; attempt < 48; attempt++) {
      const radius = spread * (attempt / 48);
      const angle = attempt * 2.399963; // golden angle keeps samples spread out
      const candidate: MapRect = {
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius,
        width: size,
        height: size,
      };
      if (this.isFreeGround(candidate, apron)) return candidate;
    }
    return null;
  }

  private generateDestructibles() {
    let dId = 0;

    const place = (
      type: DestructibleObject['type'],
      idPrefix: string,
      x: number,
      y: number,
      size: number,
      health: number,
      spread: number,
      angle = 0
    ) => {
      const spot = this.findFreeGround(x, y, size, spread);
      if (!spot) return false;
      this.destructibles.push({
        id: `${idPrefix}_${dId++}`,
        type,
        x: spot.x,
        y: spot.y,
        angle,
        width: size,
        height: size,
        health,
        maxHealth: health,
        isDestroyed: false,
        respawnTime: 0,
      });
      return true;
    };

    // Cones, hydrants and lamps sit on the sidewalk corners of an intersection.
    // The old offset was derived from inter.size alone, which is narrower than
    // the arterials that meet there, so every corner prop landed on asphalt.
    this.intersections.forEach((inter) => {
      const corner = inter.size / 2 + 46;
      const corners = [
        { x: inter.x - corner, y: inter.y - corner },
        { x: inter.x + corner, y: inter.y - corner },
        { x: inter.x - corner, y: inter.y + corner },
        { x: inter.x + corner, y: inter.y + corner },
      ];
      corners.forEach((spot) => place('cone', 'prop_cone', spot.x, spot.y, 10, 15, 190, this.rng() * Math.PI * 2));
      place('hydrant', 'prop_hydrant', inter.x + corner, inter.y - corner, 14, 40, 210);
      place('lamp_pole', 'prop_lamp', inter.x - corner, inter.y - corner, 16, 80, 210);
      place('lamp_pole', 'prop_lamp', inter.x + corner, inter.y + corner, 16, 80, 210);
    });

    // Crates and barrels around the loading yards.
    const crateAreas = [
      { x: 1835, y: 1166, count: 18 }, // Construction
      { x: 220, y: 1800, count: 20 },  // Harbor
      { x: 2546, y: 2083, count: 16 }, // Warehouse
      { x: 1000, y: 1000, count: 12 }, // KAMAZ Depot
      { x: 3340, y: 1800, count: 14 }, // Quarry
    ];

    crateAreas.forEach((area) => {
      for (let i = 0; i < area.count; i++) {
        const isBarrel = i % 3 === 0;
        place(
          isBarrel ? 'barrel' : 'crate',
          `prop_${isBarrel ? 'barrel' : 'crate'}`,
          area.x + (this.rng() * 200 - 100),
          area.y + (this.rng() * 180 - 90),
          isBarrel ? 14 : 18,
          isBarrel ? 35 : 25,
          150,
          this.rng() * Math.PI * 2
        );
      }
    });

    // Fences and trash cans follow the verge of a road. They used to be laid
    // out on a straight line derived from the road's first point, which for a
    // polyline has nothing to do with where the asphalt actually runs.
    this.roads.forEach((road, roadIndex) => {
      const verge = road.width / 2 + 40;
      const steps = road.roadClass === 'arterial' ? 5 : 3;
      for (let step = 0; step < steps; step++) {
        const t = (step + 0.5) / steps;
        const spanIndex = Math.min(road.points.length - 2, Math.floor(t * (road.points.length - 1)));
        const from = road.points[spanIndex];
        const to = road.points[spanIndex + 1];
        const local = t * (road.points.length - 1) - spanIndex;
        const cxOnRoad = from.x + (to.x - from.x) * local;
        const cyOnRoad = from.y + (to.y - from.y) * local;
        const tangentLength = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const normalX = -(to.y - from.y) / tangentLength;
        const normalY = (to.x - from.x) / tangentLength;
        const side = (roadIndex + step) % 2 === 0 ? 1 : -1;
        const heading = Math.atan2(to.y - from.y, to.x - from.x);

        place('fence', 'prop_fence', cxOnRoad + normalX * verge * side, cyOnRoad + normalY * verge * side, 36, 50, 120, heading);
        place('trash_can', 'prop_trash', cxOnRoad + normalX * (verge + 34) * side, cyOnRoad + normalY * (verge + 34) * side, 14, 30, 120, this.rng());
      }
    });
  }

  // Update Traffic Lights Cycles (Green -> Yellow -> Red -> Green)
  public updateTrafficLights(delta: number) {
    const cycleDuration = 14; // seconds total

    this.intersections.forEach((inter) => {
      inter.timer += delta;
      if (inter.timer > cycleDuration) {
        inter.timer = 0;
      }

      // Phase 0: North-South Green (0 to 5.5s)
      // Phase 1: North-South Yellow (5.5 to 7.0s)
      // Phase 2: East-West Green (7.0 to 12.5s)
      // Phase 3: East-West Yellow (12.5 to 14.0s)
      let nsState: 'green' | 'yellow' | 'red' = 'red';
      let ewState: 'green' | 'yellow' | 'red' = 'red';

      if (inter.timer < 5.5) {
        nsState = 'green';
        ewState = 'red';
      } else if (inter.timer < 7.0) {
        nsState = 'yellow';
        ewState = 'red';
      } else if (inter.timer < 12.5) {
        nsState = 'red';
        ewState = 'green';
      } else {
        nsState = 'red';
        ewState = 'yellow';
      }

      // Update light entities
      this.trafficLights.forEach((tl) => {
        if (tl.intersectionId === inter.id) {
          if (tl.direction === 'north' || tl.direction === 'south') {
            tl.state = nsState;
            tl.pedestrianState = nsState === 'green' ? 'dont_walk' : 'walk';
          } else {
            tl.state = ewState;
            tl.pedestrianState = ewState === 'green' ? 'dont_walk' : 'walk';
          }
        }
      });
    });
  }

  // Find the nearest street by the actual centerline, including bends and
  // ramps. Comparing only x/y to the first point made the HUD name disagree
  // with the road shown under the vehicle.
  public getStreetNameAt(x: number, y: number): string {
    let nearestDist = Infinity;
    let nearestName = 'Grand Boulevard';

    this.roads.forEach((road) => {
      let dist = Infinity;
      for (let i = 1; i < road.points.length; i += 1) {
        dist = Math.min(
          dist,
          pointToSegment(x, y, road.points[i - 1].x, road.points[i - 1].y, road.points[i].x, road.points[i].y)
        );
      }

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestName = road.name;
      }
    });

    // Check if inside or near a POI
    for (const poi of this.pois) {
      if (
        x >= poi.x - poi.width / 2 &&
        x <= poi.x + poi.width / 2 &&
        y >= poi.y - poi.height / 2 &&
        y <= poi.y + poi.height / 2
      ) {
        return `${poi.nameRu} (${poi.name})`;
      }
    }

    return nearestName;
  }
}
