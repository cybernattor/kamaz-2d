import { Mission, PointOfInterest, VehicleCategory } from '../types';

export class MissionManager {
  public missions: Mission[] = [];
  public activeMission: Mission | null = null;
  public missionStage: 'pickup' | 'delivery' = 'pickup';

  constructor() {
    this.initMissions();
  }

  public initMissions() {
    this.missions = [
      {
        id: 'mis_kamaz_sand',
        title: 'Heavy Quarry Haul: Sand & Gravel',
        titleRu: 'Рейс КАМАЗ: Доставка Песка на Стройку',
        category: 'construction',
        description: 'Load fresh river sand at the Quarry and deliver 5 tons of raw material to the Monolith Construction site.',
        descriptionRu: 'Загрузите 5 тонн речного песка в Карьере и доставьте на стройплощадку ЖК «Монолит».',
        sourcePoiId: 'poi_quarry',
        targetPoiId: 'poi_construction',
        rewardMoney: 15000,
        rewardXp: 350,
        requiredVehicleType: 'kamaz_dump',
        cargoName: 'Речной Песок (5т)',
        cargoAmount: 5,
        timeLimitSeconds: 160,
        currentSeconds: 160,
        status: 'available',
      },
      {
        id: 'mis_port_containers',
        title: 'Harbor Freight: Industrial Generators',
        titleRu: 'Транспортировка из Порта на Склад',
        category: 'delivery',
        description: 'Transport high-voltage industrial machinery from the Commercial Harbor to the Mega Logistics Center.',
        descriptionRu: 'Заберите тяжелое генераторное оборудование из Морского Порта и привезите на Склад Wildbox.',
        sourcePoiId: 'poi_port',
        targetPoiId: 'poi_warehouse',
        rewardMoney: 22000,
        rewardXp: 500,
        requiredVehicleType: 'kamaz_flatbed',
        cargoName: 'Генераторы 1000кВт',
        cargoAmount: 2,
        timeLimitSeconds: 180,
        currentSeconds: 180,
        status: 'available',
      },
      {
        id: 'mis_emergency_call',
        title: 'Code Red: Hospital Emergency',
        titleRu: 'Срочный вызов: Скорая Помощь',
        category: 'emergency',
        description: 'Rush to the emergency scene with sirens blazing and transport the patient safely to Central Hospital.',
        descriptionRu: 'Включите спецсирену на Скорой, заберите пациента у АЗС и срочно доставьте в Городскую Больницу!',
        sourcePoiId: 'poi_gas_station',
        targetPoiId: 'poi_hospital',
        rewardMoney: 18000,
        rewardXp: 400,
        requiredVehicleType: 'ambulance',
        timeLimitSeconds: 110,
        currentSeconds: 110,
        status: 'available',
      },
      {
        id: 'mis_police_patrol',
        title: 'Highway Patrol: Rapid Response',
        titleRu: 'Патруль ДПС: Срочный Выезд',
        category: 'patrol',
        description: 'Patrol Grand Boulevard and inspect the cargo traffic near the Truck Depot.',
        descriptionRu: 'Прибудьте на патрульном экипаже ДПС к Главной Автобазе КАМАЗ для проверки путевых листов.',
        sourcePoiId: 'poi_police',
        targetPoiId: 'poi_depot',
        rewardMoney: 12000,
        rewardXp: 300,
        requiredVehicleType: 'police',
        timeLimitSeconds: 120,
        currentSeconds: 120,
        status: 'available',
      },
      {
        id: 'mis_fragile_glass',
        title: 'Fragile Delivery: Architectural Glass',
        titleRu: 'Хрупкий Груз: Витражные Стеклопакеты',
        category: 'fragile',
        description: 'Transport sensitive skyscraper windows without heavy collisions or excessive bumps.',
        descriptionRu: 'Перевезите хрупкие стеклопакеты с Автобазы на Стройку. Избегайте ударов и столкновений!',
        sourcePoiId: 'poi_depot',
        targetPoiId: 'poi_construction',
        rewardMoney: 28000,
        rewardXp: 600,
        cargoName: 'Витражное Стекло',
        cargoAmount: 1,
        timeLimitSeconds: 170,
        currentSeconds: 170,
        status: 'available',
      },
      {
        id: 'mis_taxi_ride',
        title: 'VIP City Taxi: Airport Transfer',
        titleRu: 'Городское Такси: Заказ в Порт',
        category: 'taxi',
        description: 'Pick up passenger from the Central Hospital and drive smoothly to the Harbor Terminal.',
        descriptionRu: 'Заберите пассажира у Больницы и с комфортом отвезите к причалу Морского Порта.',
        sourcePoiId: 'poi_hospital',
        targetPoiId: 'poi_port',
        rewardMoney: 9500,
        rewardXp: 220,
        timeLimitSeconds: 130,
        currentSeconds: 130,
        status: 'available',
      },
    ];
  }

  public startMission(missionId: string): boolean {
    const mis = this.missions.find((m) => m.id === missionId);
    if (!mis || mis.status === 'completed') return false;

    if (this.activeMission && this.activeMission.status === 'active') {
      this.activeMission.status = 'available';
    }

    mis.status = 'active';
    mis.currentSeconds = mis.timeLimitSeconds || 160;
    this.activeMission = mis;
    this.missionStage = mis.sourcePoiId ? 'pickup' : 'delivery';
    return true;
  }

  public update(delta: number): { completed?: Mission; failed?: Mission } {
    if (!this.activeMission || this.activeMission.status !== 'active') return {};

    if (this.activeMission.currentSeconds !== undefined) {
      this.activeMission.currentSeconds -= delta;
      if (this.activeMission.currentSeconds <= 0) {
        this.activeMission.status = 'failed';
        const failed = this.activeMission;
        this.activeMission = null;
        return { failed };
      }
    }

    return {};
  }

  public checkZoneArrival(
    playerX: number,
    playerY: number,
    pois: PointOfInterest[]
  ): { completedMission?: Mission; reachedPickup?: boolean; pickupPoi?: PointOfInterest } {
    if (!this.activeMission || this.activeMission.status !== 'active') return {};

    // 1. If currently in pickup phase:
    if (this.missionStage === 'pickup') {
      const sourcePoi = pois.find((p) => p.id === this.activeMission!.sourcePoiId);
      if (sourcePoi) {
        const dist = Math.hypot(sourcePoi.x - playerX, sourcePoi.y - playerY);
        const triggerRadius = Math.max(sourcePoi.width, sourcePoi.height) * 0.6;
        if (dist < triggerRadius) {
          this.missionStage = 'delivery';
          return { reachedPickup: true, pickupPoi: sourcePoi };
        }
      }
    }

    // 2. Delivery Destination
    const targetPoi = pois.find((p) => p.id === this.activeMission!.targetPoiId);
    if (!targetPoi) return {};

    const dist = Math.hypot(targetPoi.x - playerX, targetPoi.y - playerY);
    const triggerRadius = Math.max(targetPoi.width, targetPoi.height) * 0.6;

    if (dist < triggerRadius) {
      this.activeMission.status = 'completed';
      const completed = this.activeMission;
      this.activeMission = null;
      this.missionStage = 'pickup';

      // Check if need to generate dynamic contract
      this.ensureAvailableContracts(pois);

      return { completedMission: completed };
    }

    return {};
  }

  public generateRandomContract(pois: PointOfInterest[]): Mission {
    const validSources = pois.filter((p) => p.type !== 'workshop');
    const source = validSources[Math.floor(Math.random() * validSources.length)] || pois[0];
    let target = validSources[Math.floor(Math.random() * validSources.length)] || pois[1];
    if (target.id === source.id) {
      target = pois.find((p) => p.id !== source.id) || pois[1];
    }

    const cargoes = [
      { name: 'Щебень Гранитный (8т)', type: 'construction', rew: 18000, xp: 420 },
      { name: 'Стальная Арматура (6т)', type: 'construction', rew: 21000, xp: 480 },
      { name: 'Контейнер с Электроникой', type: 'delivery', rew: 24000, xp: 520 },
      { name: 'Партия Автозапчастей', type: 'delivery', rew: 16000, xp: 360 },
      { name: 'Строительный Бетон', type: 'construction', rew: 19500, xp: 440 },
    ];
    const cargo = cargoes[Math.floor(Math.random() * cargoes.length)];
    const id = `mis_dyn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const newMis: Mission = {
      id,
      title: `Freight Haul: ${cargo.name}`,
      titleRu: `Рейс: ${cargo.name}`,
      category: cargo.type as any,
      description: `Transport ${cargo.name} from ${source.nameRu} to ${target.nameRu}.`,
      descriptionRu: `Заберите ${cargo.name} в локации «${source.nameRu}» и доставьте в «${target.nameRu}».`,
      sourcePoiId: source.id,
      targetPoiId: target.id,
      rewardMoney: cargo.rew,
      rewardXp: cargo.xp,
      cargoName: cargo.name,
      cargoAmount: 5,
      timeLimitSeconds: 180,
      currentSeconds: 180,
      status: 'available',
    };

    this.missions.push(newMis);
    return newMis;
  }

  private ensureAvailableContracts(pois: PointOfInterest[]) {
    const availableCount = this.missions.filter((m) => m.status === 'available').length;
    if (availableCount < 2) {
      this.generateRandomContract(pois);
      this.generateRandomContract(pois);
    }
  }
}
