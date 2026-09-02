import { DestructibleObject, MapDecoration, MapTrail, PointOfInterest, TrafficLight } from '../types';

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
}

export interface Intersection {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  timer: number;
  phase: number; // 0: N-S Green, 1: N-S Yellow, 2: E-W Green, 3: E-W Yellow
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

  constructor() {
    this.generateLayout();
  }

  private generateLayout() {
    // 1. Grid of Major Avenues and Streets
    // North-South Avenues: x = 600, 1400, 2200, 3000
    // East-West Boulevards: y = 600, 1400, 2200, 3000
    const gridX = [600, 1400, 2200, 3000];
    const gridY = [600, 1400, 2200, 3000];

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

    // Create Road Segments
    gridX.forEach((gx, idx) => {
      this.roads.push({
        id: `road_v_${idx}`,
        name: avenueNamesX[idx],
        x1: gx,
        y1: 100,
        x2: gx,
        y2: WORLD_SIZE - 100,
        width: 140, // 4-lane width
        lanes: 4,
        speedLimit: 60,
        isVertical: true,
      });
    });

    gridY.forEach((gy, idy) => {
      this.roads.push({
        id: `road_h_${idy}`,
        name: avenueNamesY[idy],
        x1: 100,
        y1: gy,
        x2: WORLD_SIZE - 100,
        y2: gy,
        width: 140,
        lanes: 4,
        speedLimit: 60,
        isVertical: false,
      });
    });

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
          size: 140,
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
    ];

    // 3. City Blocks & Buildings (Filling blocks between roads)
    this.generateCityBlocks();

    // 4. Parks, water and industrial yards keep the city from becoming a
    // uniform grid of identical crossroads.
    this.generateMapDecorations();
    this.generateScenicRoutes();

    // 5. Destructibles (Crates, cones, lamps, hydrants, fences, trash cans)
    this.generateDestructibles();
  }

  private generateCityBlocks() {
    // Generate styled buildings and structures in non-POI city block areas
    const blockRegions = [
      // Top row
      // Reserved for the lake district.
      { minX: 760, maxX: 1240, minY: 160, maxY: 460 },
      { minX: 1560, maxX: 2040, minY: 160, maxY: 460 },
      { minX: 2360, maxX: 2840, minY: 160, maxY: 460 },
      // Reserved for the transport plaza.

      // Row 2
      { minX: 160, maxX: 460, minY: 760, maxY: 1240 },
      // Reserved for Central Park.
      { minX: 3140, maxX: 3440, minY: 760, maxY: 1240 },

      // Row 3
      { minX: 3140, maxX: 3440, minY: 2360, maxY: 2840 },
      // Reserved for the forest promenade.
      { minX: 760, maxX: 1240, minY: 2360, maxY: 2840 },

      // Bottom Row
      { minX: 160, maxX: 460, minY: 3140, maxY: 3440 },
      { minX: 760, maxX: 1240, minY: 3140, maxY: 3440 },
      // Reserved for the industrial yard.
      { minX: 2360, maxX: 2840, minY: 3140, maxY: 3440 },
      { minX: 3140, maxX: 3440, minY: 3140, maxY: 3440 },
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
      const countX = 2;
      const countY = 2;
      const stepW = (region.maxX - region.minX) / countX;
      const stepH = (region.maxY - region.minY) / countY;

      for (let bx = 0; bx < countX; bx++) {
        for (let by = 0; by < countY; by++) {
          const bw = stepW - 36;
          const bh = stepH - 36;
          const px = region.minX + bx * stepW + 18 + bw / 2;
          const py = region.minY + by * stepH + 18 + bh / 2;
          const theme = buildingColors[(rIdx + bx * 2 + by) % buildingColors.length];

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
      const corners = [
        { x: inter.x - 65, y: inter.y - 65 },
        { x: inter.x + 65, y: inter.y - 65 },
        { x: inter.x - 65, y: inter.y + 65 },
        { x: inter.x + 65, y: inter.y + 65 },
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
        x: inter.x + 85,
        y: inter.y - 85,
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
          x: inter.x - 85,
          y: inter.y - 85,
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
          x: inter.x + 85,
          y: inter.y + 85,
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
      const offset = 80;
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
