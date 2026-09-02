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

  constructor() {
    this.generateLayout();
  }

  private generateLayout() {
    // The driving controller still exposes four cardinal lanes for the
    // deterministic traffic simulation. The world itself is no longer a
    // repeated grid: these are uneven spines, while the secondary roads,
    // ring road and country routes create the actual district-to-district
    // network.
    const gridX = [520, 1320, 2200, 3040];
    const gridY = [620, 1450, 2320, 3100];

    this.districts = [
      { id: 'district-downtown', name: 'Центр', kind: 'downtown', x: 1510, y: 1130, width: 1060, height: 860, color: '#172554', accent: '#38bdf8' },
      { id: 'district-residential', name: 'Жилые кварталы', kind: 'residential', x: 620, y: 1300, width: 1040, height: 1160, color: '#164e63', accent: '#67e8f9' },
      { id: 'district-port', name: 'Порт и железная дорога', kind: 'port', x: 520, y: 520, width: 960, height: 720, color: '#164e63', accent: '#22d3ee' },
      { id: 'district-industrial', name: 'Промзона и аэропорт', kind: 'industrial', x: 2670, y: 1330, width: 1320, height: 1120, color: '#3f3f46', accent: '#f59e0b' },
      { id: 'district-desert', name: 'Карьерная окраина', kind: 'desert', x: 2680, y: 3000, width: 1320, height: 940, color: '#78350f', accent: '#fbbf24' },
      { id: 'district-nature', name: 'Лес, холмы и озеро', kind: 'nature', x: 850, y: 3000, width: 1660, height: 940, color: '#14532d', accent: '#86efac' },
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

    // Uneven arterial spines. They retain predictable cardinal portions for
    // current traffic lights, but their endpoints and visual geometry vary by
    // district instead of producing a 4x4 carpet of identical roads.
    gridX.forEach((gx, idx) => {
      const points: RoadPoint[] = [{ x: gx, y: 160 }];
      gridY.forEach((gy, crossingIndex) => {
        if (crossingIndex > 0) {
          const previousY = gridY[crossingIndex - 1];
          points.push({ x: gx + (idx % 2 === 0 ? -24 : 24), y: (previousY + gy) / 2 });
        }
        points.push({ x: gx, y: gy });
      });
      points.push({ x: gx + (idx % 2 === 0 ? -18 : 18), y: WORLD_SIZE - 130 });
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
        if (crossingIndex > 0) {
          const previousX = gridX[crossingIndex - 1];
          points.push({ x: (previousX + gx) / 2, y: gy + (idy % 2 === 0 ? 20 : -20) });
        }
        points.push({ x: gx, y: gy });
      });
      points.push({ x: WORLD_SIZE - 120, y: gy + (idy % 2 === 0 ? 18 : -18) });
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
      road('road-airport-ramp', 'Развязка к аэропорту', [
        { x: 2200, y: 1450 }, { x: 2430, y: 1280 }, { x: 2700, y: 1190 }, { x: 3100, y: 1180 },
      ], 'highway', 1, 70, 'district-industrial', { isVertical: false, directionMode: 'one-way', feature: 'ramp' }),
      road('road-airport-exit', 'Съезд из аэропорта', [
        { x: 3100, y: 1180 }, { x: 2860, y: 1260 }, { x: 2560, y: 1380 }, { x: 2200, y: 1450 },
      ], 'highway', 1, 70, 'district-industrial', { isVertical: false, directionMode: 'one-way', feature: 'ramp' }),
      road('road-port-access', 'Портовый проезд', [
        { x: 140, y: 620 }, { x: 330, y: 790 }, { x: 720, y: 820 }, { x: 980, y: 700 },
      ], 'service', 1, 35, 'district-port', { isVertical: false, directionMode: 'two-way', feature: 'rail_crossing' }),
      road('road-winding-country', 'Загородная извилистая', [
        { x: 820, y: 3050 }, { x: 650, y: 3260 }, { x: 790, y: 3440 }, { x: 1180, y: 3510 },
        { x: 1480, y: 3370 }, { x: 1740, y: 3500 }, { x: 2120, y: 3380 }, { x: 2420, y: 3500 },
      ], 'dirt', 1, 28, 'district-nature', { isVertical: false, directionMode: 'two-way', feature: 'winding' }),
      road('road-market-one-way', 'Рыночный переулок', [
        { x: 1120, y: 780 }, { x: 1500, y: 760 }, { x: 1780, y: 920 }, { x: 1780, y: 1260 },
      ], 'street', 1, 35, 'district-downtown', { isVertical: false, directionMode: 'one-way', feature: 'roundabout' }),
      road('road-quarry-service', 'Карьерная объездная', [
        { x: 2500, y: 3000 }, { x: 2800, y: 2860 }, { x: 3240, y: 2920 }, { x: 3480, y: 3180 },
      ], 'service', 1, 40, 'district-desert', { isVertical: false, directionMode: 'two-way' }),
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
          size: ix === 1 && iy === 1 ? 190 : 140,
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
      { id: 'inter_roundabout_market', name: 'Круговое движение у рынка', x: 1780, y: 920, size: 180, timer: 0, phase: 2, trafficControlled: false },
      { id: 'inter_t_port', name: 'Т-перекрёсток у порта', x: 720, y: 820, size: 120, timer: 3, phase: 0, trafficControlled: false },
      { id: 'inter_t_quarry', name: 'Т-перекрёсток у карьера', x: 2800, y: 2860, size: 120, timer: 6, phase: 2, trafficControlled: false },
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
        x: 1800,
        y: 1000,
        width: 340,
        height: 260,
        color: '#eab308',
        icon: 'HardHat',
        description: 'Строящийся жилой комплекс. Требуются постоянные поставки бетона, кирпича и балок.',
      },
      {
        id: 'poi_port',
        name: 'Commercial Cargo Harbor',
        nameRu: 'Грузовой Морской Порт',
        type: 'port',
        x: 260,
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
        x: 1800,
        y: 2600,
        width: 300,
        height: 240,
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
        x: 2600,
        y: 2600,
        width: 320,
        height: 260,
        color: '#8b5cf6',
        icon: 'Package',
        description: 'Автоматизированный логистический хаб. Срочные экспресс-доставки товаров.',
      },
      {
        id: 'poi_airport',
        name: 'North Cargo Airport',
        nameRu: 'Грузовой аэропорт «Северный»',
        type: 'airport',
        x: 3000,
        y: 980,
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
        x: 680,
        y: 430,
        width: 360,
        height: 180,
        color: '#a78bfa',
        icon: 'TrainFront',
        description: 'Перегрузка контейнеров между вагонами и грузовиками.',
      },
      {
        id: 'poi_truck_stop',
        name: 'Dusty Mile Truck Stop',
        nameRu: 'Придорожный мотель и стоянка',
        type: 'truck_stop',
        x: 3180,
        y: 3000,
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
        x: 1780,
        y: 920,
        width: 300,
        height: 220,
        color: '#facc15',
        icon: 'Store',
        description: 'Городской рынок с короткими маршрутами, погрузочными карманами и круговым движением.',
      },
      {
        id: 'poi_lookout',
        name: 'Pine Ridge Lookout',
        nameRu: 'Смотровая площадка «Сосновый кряж»',
        type: 'lookout',
        x: 820,
        y: 3220,
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
        x: 360,
        y: 3000,
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
    this.buildRoadNetwork();

    // 5. Destructibles (Crates, cones, lamps, hydrants, fences, trash cans)
    this.generateDestructibles();
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
    this.roadNodes.push({ id: 'node-airport', x: 3100, y: 1180, kind: 'terminal' });

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

  /** Lane centers for the straight driving spines; used by AI tests and tools. */
  public getLaneCenters(roadId: string, direction: 'north' | 'south' | 'east' | 'west') {
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
    const centers = Array.from({ length: road.lanesPerDirection }, (_, lane) => {
      const offset = 34 + lane * 54;
      if (road.isVertical) return { x: direction === 'south' ? road.x1 + offset : road.x1 - offset, y: road.y1 };
      return { x: road.x1, y: direction === 'east' ? road.y1 + offset : road.y1 - offset };
    });
    return centers;
  }

  private generateCityBlocks() {
    // Generate styled buildings and structures in non-POI city block areas
    const blockRegions = [
      // Port warehouses and older residential blocks.
      { minX: 160, maxX: 430, minY: 180, maxY: 390 },
      { minX: 930, maxX: 1260, minY: 180, maxY: 430 },
      { minX: 1420, maxX: 1760, minY: 240, maxY: 520 },
      { minX: 1920, maxX: 2240, minY: 220, maxY: 500 },
      { minX: 2700, maxX: 2960, minY: 260, maxY: 500 },
      // Downtown is deliberately denser and irregular.
      { minX: 1080, maxX: 1270, minY: 850, maxY: 1190 },
      { minX: 1360, maxX: 1580, minY: 820, maxY: 1210 },
      { minX: 1880, maxX: 2180, minY: 1120, maxY: 1370 },
      { minX: 940, maxX: 1180, minY: 1600, maxY: 1950 },
      { minX: 2360, maxX: 2610, minY: 820, maxY: 1160 },
      // Residential cul-de-sacs.
      { minX: 170, maxX: 430, minY: 1680, maxY: 2050 },
      { minX: 720, maxX: 1030, minY: 2050, maxY: 2220 },
      { minX: 1100, maxX: 1260, minY: 2420, maxY: 2780 },
      // Industrial hangars and quarry service compounds.
      { minX: 2700, maxX: 2980, minY: 1650, maxY: 1960 },
      { minX: 3160, maxX: 3440, minY: 1650, maxY: 2050 },
      { minX: 2500, maxX: 2740, minY: 2450, maxY: 2700 },
      { minX: 3160, maxX: 3480, minY: 2460, maxY: 2740 },
    ];

    const buildingColors = [
      { base: '#0f172a', roof: '#1e293b', neon: '#38bdf8' },
      { base: '#111827', roof: '#1f2937', neon: '#fbbf24' },
      { base: '#18181b', roof: '#27272a', neon: '#34d399' },
      { base: '#090d16', roof: '#172033', neon: '#f43f5e' },
      { base: '#141e33', roof: '#1e2942', neon: '#a855f7' },
    ];

    let bId = 0;
    blockRegions.forEach((region, rIdx) => {
      // Create 2 to 4 buildings per block
      const countX = rIdx % 4 === 0 ? 3 : 2;
      const countY = rIdx % 5 === 0 ? 1 : 2;
      const stepW = (region.maxX - region.minX) / countX;
      const stepH = (region.maxY - region.minY) / countY;

      for (let bx = 0; bx < countX; bx++) {
        for (let by = 0; by < countY; by++) {
          const bw = stepW - 36;
          const bh = stepH - 36;
          const px = region.minX + bx * stepW + 18 + bw / 2;
          const py = region.minY + by * stepH + 18 + bh / 2;
          const theme = buildingColors[(rIdx + bx * 2 + by) % buildingColors.length];

          // Leave a broad safety apron beside every driveable corridor. The
          // visual block can be close to a road, but a building must never
          // become an invisible collision placed on an NPC lane.
          const tooCloseToRoad = this.roads.some((road) => {
            const distance = Math.min(...road.points.map((point) => road.isVertical ? Math.abs(px - point.x) : Math.abs(py - point.y)));
            return distance < road.width / 2 + 58;
          });
          if (tooCloseToRoad) continue;

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
    });
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
        y: 500,
        width: 1250,
        height: 70,
        label: 'Железнодорожный коридор',
      },
      {
        id: 'zone_airport_runway',
        type: 'airport',
        x: 3020,
        y: 760,
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

  private generateDestructibles() {
    let dId = 0;

    // Place traffic cones around intersections and construction site
    this.intersections.forEach((inter) => {
      // 4 cones around crosswalk corners
      const sidewalkOffset = inter.size / 2 + 34;
      const corners = [
        { x: inter.x - sidewalkOffset, y: inter.y - sidewalkOffset },
        { x: inter.x + sidewalkOffset, y: inter.y - sidewalkOffset },
        { x: inter.x - sidewalkOffset, y: inter.y + sidewalkOffset },
        { x: inter.x + sidewalkOffset, y: inter.y + sidewalkOffset },
      ];

      corners.forEach((c) => {
        this.destructibles.push({
          id: `prop_cone_${dId++}`,
          type: 'cone',
          x: c.x + (Math.random() * 10 - 5),
          y: c.y + (Math.random() * 10 - 5),
          angle: Math.random() * Math.PI * 2,
          width: 10,
          height: 10,
          health: 15,
          maxHealth: 15,
          isDestroyed: false,
          respawnTime: 0,
        });
      });

      // Fire Hydrants near corners
      this.destructibles.push({
        id: `prop_hydrant_${dId++}`,
        type: 'hydrant',
        x: inter.x + inter.size / 2 + 52,
        y: inter.y - inter.size / 2 - 52,
        angle: 0,
        width: 14,
        height: 14,
        health: 40,
        maxHealth: 40,
        isDestroyed: false,
        respawnTime: 0,
      });

      // Street Lamps along corners
      this.destructibles.push(
        {
          id: `prop_lamp_${dId++}`,
          type: 'lamp_pole',
          x: inter.x - inter.size / 2 - 52,
          y: inter.y - inter.size / 2 - 52,
          angle: 0,
          width: 16,
          height: 16,
          health: 80,
          maxHealth: 80,
          isDestroyed: false,
          respawnTime: 0,
        },
        {
          id: `prop_lamp_${dId++}`,
          type: 'lamp_pole',
          x: inter.x + inter.size / 2 + 52,
          y: inter.y + inter.size / 2 + 52,
          angle: 0,
          width: 16,
          height: 16,
          health: 80,
          maxHealth: 80,
          isDestroyed: false,
          respawnTime: 0,
        }
      );
    });

    // Place Wooden Crates and Barrels at Construction Site & Warehouses & Harbor
    const crateAreas = [
      { x: 1800, y: 1000, count: 18 }, // Construction
      { x: 260, y: 1800, count: 20 },  // Harbor
      { x: 2600, y: 2600, count: 16 }, // Warehouse
      { x: 1000, y: 1000, count: 12 }, // KAMAZ Depot
      { x: 3340, y: 1800, count: 14 }, // Quarry
    ];

    crateAreas.forEach((area) => {
      for (let i = 0; i < area.count; i++) {
        const isBarrel = i % 3 === 0;
        this.destructibles.push({
          id: `prop_${isBarrel ? 'barrel' : 'crate'}_${dId++}`,
          type: isBarrel ? 'barrel' : 'crate',
          x: area.x + (Math.random() * 200 - 100),
          y: area.y + (Math.random() * 180 - 90),
          angle: Math.random() * Math.PI * 2,
          width: isBarrel ? 14 : 18,
          height: isBarrel ? 14 : 18,
          health: isBarrel ? 35 : 25,
          maxHealth: isBarrel ? 35 : 25,
          isDestroyed: false,
          respawnTime: 0,
        });
      }
    });

    // Fences and Road Barriers
    for (let f = 0; f < 30; f++) {
      const road = this.roads[f % this.roads.length];
      const offset = road.width / 2 + 42;
      const px = road.isVertical ? road.x1 + offset : 400 + f * 95;
      const py = road.isVertical ? 400 + f * 95 : road.y1 + offset;

      this.destructibles.push({
        id: `prop_fence_${dId++}`,
        type: 'fence',
        x: px,
        y: py,
        angle: road.isVertical ? Math.PI / 2 : 0,
        width: 36,
        height: 10,
        health: 50,
        maxHealth: 50,
        isDestroyed: false,
        respawnTime: 0,
      });

      this.destructibles.push({
        id: `prop_trash_${dId++}`,
        type: 'trash_can',
        x: px + 25,
        y: py + (road.isVertical ? 15 : 25),
        angle: Math.random(),
        width: 14,
        height: 14,
        health: 30,
        maxHealth: 30,
        isDestroyed: false,
        respawnTime: 0,
      });
    }
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

  // Find nearest street name by coordinate for the HUD header (e.g. "Grand Boulevard", "Broadway Avenue")
  public getStreetNameAt(x: number, y: number): string {
    let nearestDist = Infinity;
    let nearestName = 'Grand Boulevard';

    this.roads.forEach((road) => {
      let dist = 0;
      if (road.isVertical) {
        dist = Math.abs(x - road.x1);
      } else {
        dist = Math.abs(y - road.y1);
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
