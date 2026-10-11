import { Pedestrian, VehicleConfig, VehicleInstance } from '../types';
import { CityMap, CROSSWALK_DEPTH, Intersection, RoadSegment, WORLD_SIZE } from './cityMap';
import { KMH_TO_WORLD_SPEED, VEHICLE_CONFIGS } from './vehicleConfigs';
import { integrateVehicleSpeed } from './vehicleDynamics';
import { SpatialHash } from './spatialHash';

/** Distance before a capped arterial end at which an NPC turns around. */
const ROAD_END_TURN_DISTANCE = 90;
/** Speed an NPC turns around at the end of an arterial. */
const ROAD_END_CRAWL_SPEED = 1.5;
/** How far past its start point a road-end U-turn reaches. */
const ROAD_END_UTURN_REACH = 40;
/**
 * Steepest heading, relative to the lane, a car takes while shifting
 * sideways (tan of ~24 degrees). Lateral movement comes only from forward
 * motion along that heading, so a car never slides sideways on the spot.
 */
const MAX_LANE_SHIFT_SLOPE = 0.45;
/** Speed an NPC backs up at to get room to pull out around a stopped vehicle. */
const BYPASS_REVERSE_SPEED = 1.2;
/** Parking bays stay this far from a capped arterial end. */
const ROAD_END_PARKING_MARGIN = 260;

/**
 * Deceleration an NPC plans its stops with. The speed integrator brakes at
 * config.braking * 0.72 once the target is well below the current speed;
 * a quarter of that is held in reserve because it only brakes once the
 * target is 0.5 below the current speed, so a car planned at full service
 * braking lags its curve and arrives short.
 */
function getPlanningBraking(config: VehicleConfig) {
  return config.braking * 0.72 * 0.75;
}

/**
 * Fastest speed from which an NPC can still stop within `room` world units.
 * Speed moves a car `speed` units per 1/60 s, so braking from v to 0 at
 * rate b covers 60 * v^2 / (2 * b) units.
 */
function getStoppingCurveSpeed(config: VehicleConfig, room: number) {
  return Math.sqrt((2 * getPlanningBraking(config) * Math.max(0, room)) / 60);
}

type BodyPose = { x: number; y: number; angle: number; type: VehicleInstance['type'] };

/**
 * Gap between two vehicle bodies as oriented rectangles (separating axis
 * test); negative when they overlap. Circles sized by vehicle length are far
 * wider than a car, so a bus counted a car standing beside its path as
 * blocking it.
 */
function getBodyClearance(first: BodyPose, second: BodyPose) {
  const corners = (body: BodyPose) => {
    const config = VEHICLE_CONFIGS[body.type] || VEHICLE_CONFIGS.sedan;
    const fx = Math.cos(body.angle);
    const fy = Math.sin(body.angle);
    const hl = config.length / 2;
    const hw = config.width / 2;
    return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]
      .map(([a, b]) => ({ x: body.x + fx * a - fy * b, y: body.y + fy * a + fx * b }));
  };
  const a = corners(first);
  const b = corners(second);
  let best = -Infinity;
  for (const body of [first, second]) {
    for (const axis of [
      { x: Math.cos(body.angle), y: Math.sin(body.angle) },
      { x: -Math.sin(body.angle), y: Math.cos(body.angle) },
    ]) {
      let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
      for (const point of a) { const p = point.x * axis.x + point.y * axis.y; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
      for (const point of b) { const p = point.x * axis.x + point.y * axis.y; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
      best = Math.max(best, minB - maxA, minA - maxB);
    }
  }
  return best;
}

export type TrafficDirection = 'north' | 'south' | 'east' | 'west';

interface NPCAIExtra {
  roadType: 'vertical' | 'horizontal';
  roadCoord: number; // gx or gy coordinate
  direction: TrafficDirection;
  laneIndex: 0 | 1;
  routeRoadIds: string[];
  routeIndex: number;
  rerouteCooldown: number;
  routeSourcePoiId?: string;
  routeTargetPoiId?: string;
  isTurning: boolean;
  /** The active turn is a U-turn at a capped arterial end: same road, opposite direction. */
  isUTurn?: boolean;
  /**
   * Stopped (or stopping) for an ordinary traffic reason this frame: a red
   * light, a leader in the queue, a yield. Nobody overtakes a car waiting in
   * a queue.
   */
  holding?: boolean;
  turnStartPos?: { x: number; y: number };
  turnEndPos?: { x: number; y: number };
  turnControlPos?: { x: number; y: number };
  turnStartAngle: number;
  turnTargetAngle: number;
  targetRoadCoord: number;
  targetDirection: TrafficDirection;
  turnProgress: number;
  lastIntersectionId?: string;
  stuckTimer: number;
  offroadTimer: number;
  progressTimer: number;
  lastX: number;
  lastY: number;
  groundBypass?: {
    intersectionId: string;
    waypoints: Array<{ x: number; y: number }>;
    waypointIndex: number;
  };
  /**
   * A sideways shift from the lane centre, driven like a real lane change
   * (see driveLaneShift): an emergency swerve toward the kerb for a head-on
   * threat, or a pass around a stopped obstacle. Released once the target is
   * behind, after which the car eases back to the lane centre.
   */
  laneShift?: {
    kind: 'evade' | 'bypass' | 'park';
    targetId: string;
    /** Signed shift from the lane centre along the road's lateral axis. */
    offset: number;
    released: boolean;
    /** Bypass only: backing up to get room to pull out. */
    reversing?: boolean;
  };
  activity: 'driving' | 'parked';
  driveTimer: number;
  nextParkingIn: number;
  parkingTimer: number;
  parkingPoiId?: string;
  parkingCoordinate?: number;
  parkingSide?: -1 | 1;
  parkingPassengers?: number;
  abandonAfterParking: boolean;
}

export class TrafficAI {
  public npcVehicles: VehicleInstance[] = [];
  public pedestrians: Pedestrian[] = [];
  private aiData: Map<string, NPCAIExtra> = new Map();
  private intersectionReservations: Map<string, string> = new Map();
  private intersectionReservationAge: Map<string, number> = new Map();
  private wasPlayerHonking = false;
  // Rebuilt once per simulation tick and shared by spacing, braking and
  // pedestrian safety checks. The old implementation rebuilt it 16 times.
  private readonly vehicleIndex = new SpatialHash<VehicleInstance>(256);
  private readonly pedestrianIndex = new SpatialHash<Pedestrian>(128);
  private readonly vehicleOrder = new Map<string, number>();

  private cityMap: CityMap;
  private maxCars = 40;
  private maxPedestrians = 35;

  private gridX: number[];
  private gridY: number[];
  /** Along-axis extent of each grid arterial, keyed by `${roadType}:${roadCoord}`. */
  private arterialExtents = new Map<string, { min: number; max: number; halfWidth: number; lanesPerDirection: number }>();
  private laneOffset = 34;
  private laneSpacing = 54;
  // Arterials are 220px wide. Keeping people another 32px beyond the curb
  // makes their corridor unambiguously a sidewalk, not the outer traffic lane.
  private readonly sidewalkOffset = 142;

  constructor(cityMap: CityMap) {
    this.cityMap = cityMap;
    this.gridX = cityMap.roads.filter((road) => road.isVertical && road.roadClass === 'arterial').map((road) => road.x1);
    this.gridY = cityMap.roads.filter((road) => !road.isVertical && road.roadClass === 'arterial').map((road) => road.y1);
    if (this.gridX.length < 2) this.gridX = [520, 1320, 2200, 3040];
    if (this.gridY.length < 2) this.gridY = [620, 1450, 2320, 3100];
    this.spawnInitialTraffic();
    this.spawnInitialPedestrians();
  }

  private getTargetLane(roadType: 'vertical' | 'horizontal', roadCoord: number, direction: TrafficDirection, laneIndex: 0 | 1 = 0) {
    const laneOffset = this.laneOffset + laneIndex * this.laneSpacing;
    if (roadType === 'vertical') {
      return {
        x: direction === 'south' ? roadCoord + laneOffset : roadCoord - laneOffset,
        angle: direction === 'south' ? Math.PI / 2 : -Math.PI / 2,
      };
    } else {
      return {
        y: direction === 'east' ? roadCoord + laneOffset : roadCoord - laneOffset,
        angle: direction === 'east' ? 0 : Math.PI,
      };
    }
  }

  private choosePedestrianWaypoint(ped: Pedestrian) {
    const roadType = ped.walkRoadType || 'vertical';
    const roadCoord = ped.walkRoadCoord ?? this.gridX[0];
    const side = ped.walkSide ?? this.sidewalkOffset;
    const current = roadType === 'vertical' ? ped.y : ped.x;
    const bounds = this.getPedestrianAxisBounds(
      current,
      this.pedestrianCrossings(ped, roadType)
    );
    let direction = ped.walkDirection ?? 1;
    const destination = direction > 0 ? bounds.upper : bounds.lower;

    if (ped.walkRoadType && ped.walkRoadCoord !== undefined && ped.walkSide !== undefined
      && Math.abs(destination - current) < 25 && Math.random() < 0.35
      && this.beginPedestrianCrosswalk(ped, destination, direction)) return;

    // A pedestrian follows one side of a block to its end. The previous
    // random destination could be behind them on every update, producing a
    // conspicuous back-and-forth shuffle on an otherwise empty sidewalk.
    if (Math.abs(destination - current) < 25) {
      direction = direction === 1 ? -1 : 1;
    }
    ped.walkDirection = direction;
    const target = direction > 0 ? bounds.upper : bounds.lower;
    if (roadType === 'vertical') {
      ped.targetX = roadCoord + side;
      ped.targetY = target;
    } else {
      ped.targetX = target;
      ped.targetY = roadCoord + side;
    }
  }

  private getNpcCruiseSpeed(car: VehicleInstance, ai: NPCAIExtra) {
    const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const road = this.cityMap.roads.find((candidate) =>
      candidate.roadClass === 'arterial' &&
      Boolean(candidate.isVertical) === (ai.roadType === 'vertical') &&
      Math.abs((ai.roadType === 'vertical' ? candidate.x1 : candidate.y1) - ai.roadCoord) < 2
    );
    // Retain the stable city-flow baseline, while respecting a lower posted
    // limit whenever a mapped arterial supplies one. Tight turns are capped
    // independently below, rather than slowing every straight-road queue.
    const baseline = Math.min(15, Math.max(8, config.maxSpeed * KMH_TO_WORLD_SPEED * 0.58));
    const postedLimit = road?.speedLimit;
    return postedLimit === undefined ? baseline : Math.min(baseline, postedLimit * KMH_TO_WORLD_SPEED * 0.9);
  }

  private getCurrentRoadId(ai: NPCAIExtra) {
    const road = this.cityMap.roads.find((candidate) =>
      candidate.roadClass === 'arterial' &&
      Boolean(candidate.isVertical) === (ai.roadType === 'vertical') &&
      Math.abs((ai.roadType === 'vertical' ? candidate.x1 : candidate.y1) - ai.roadCoord) < 2
    );
    return road?.id;
  }

  private getRouteTurn(ai: NPCAIExtra, inter: Intersection): boolean | null {
    if (!ai.routeRoadIds.length || !ai.routeTargetPoiId) return null;
    const currentRoadId = this.getCurrentRoadId(ai);
    if (currentRoadId) {
      const currentIndex = ai.routeRoadIds.indexOf(currentRoadId, Math.max(0, ai.routeIndex));
      if (currentIndex >= 0) ai.routeIndex = currentIndex;
    }
    let nextRoadId = ai.routeRoadIds[ai.routeIndex + 1];
    while (nextRoadId === currentRoadId) {
      ai.routeIndex += 1;
      nextRoadId = ai.routeRoadIds[ai.routeIndex + 1];
    }
    if (!nextRoadId) return null;
    const nextRoad = this.cityMap.roads.find((road) => road.id === nextRoadId);
    if (!nextRoad) return null;
    if (Boolean(nextRoad.isVertical) === (ai.roadType === 'vertical')) return false;

    const target = this.cityMap.pois.find((poi) => poi.id === ai.routeTargetPoiId);
    if (!target) return null;
    if (ai.roadType === 'vertical') {
      // calculateIntersectionTurn maps south->west and north->east to a right turn.
      return ai.direction === 'south' ? target.x < inter.x : target.x > inter.x;
    }
    // calculateIntersectionTurn maps east->south and west->north to a right turn.
    return ai.direction === 'east' ? target.y > inter.y : target.y < inter.y;
  }

  private planParkingStop(car: VehicleInstance, ai: NPCAIExtra) {
    if (ai.parkingCoordinate !== undefined) return;
    // Pull over only from the kerb lane: from an inner lane the move cuts
    // across traffic in the outer one.
    const extentForLanes = this.getArterialExtent(ai);
    if (extentForLanes && ai.laneIndex !== extentForLanes.lanesPerDirection - 1) return;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const candidates = this.cityMap.pois
      .map((poi) => ({
        poi,
        lateral: ai.roadType === 'vertical' ? Math.abs(poi.x - lane.x!) : Math.abs(poi.y - lane.y!),
        along: ai.roadType === 'vertical' ? poi.y : poi.x,
      }))
      .sort((a, b) => a.lateral - b.lateral);
    const forward = (value: number) => ai.direction === 'south' || ai.direction === 'east'
      ? value - (ai.roadType === 'vertical' ? car.y : car.x)
      : (ai.roadType === 'vertical' ? car.y : car.x) - value;
    // A bay already taken - parked in or claimed by another car on this
    // road - is not free: two cars pulling into the same spot collided.
    const bayTaken = (along: number) => this.npcVehicles.some((other) => {
      if (other.id === car.id || other.health <= 0) return false;
      const otherAi = this.aiData.get(other.id);
      if (!otherAi || otherAi.roadType !== ai.roadType || otherAi.roadCoord !== ai.roadCoord) return false;
      const otherAlong = otherAi.parkingCoordinate
        ?? (otherAi.activity === 'parked' ? (ai.roadType === 'vertical' ? other.y : other.x) : undefined);
      return otherAlong !== undefined && Math.abs(otherAlong - along) < 140;
    });
    const selected = candidates.find((candidate) => forward(candidate.along) > 180 && !bayTaken(candidate.along));
    if (!selected) return;
    ai.parkingPoiId = selected.poi.id;
    // Always the kerb on this car's own side: parking toward a building
    // across the road put the car in the oncoming lane, where it blocked
    // traffic until it left.
    const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
    ai.parkingSide = Math.sign(laneCoord - ai.roadCoord) >= 0 ? 1 : -1;
    // Keep the bay clear of the capped road ends, where cars slow down and
    // turn around; a bay past the end parks the car off the asphalt.
    const extent = this.getArterialExtent(ai);
    const parkingMin = extent ? extent.min + ROAD_END_PARKING_MARGIN : 180;
    const parkingMax = extent ? extent.max - ROAD_END_PARKING_MARGIN : WORLD_SIZE - 180;
    ai.parkingCoordinate = Math.max(parkingMin, Math.min(parkingMax, selected.along));
  }

  /** Along-axis extent of the grid arterial the car is driving on, if any. */
  private getArterialExtent(ai: NPCAIExtra) {
    const key = `${ai.roadType}:${ai.roadCoord}`;
    let extent = this.arterialExtents.get(key);
    if (!extent) {
      const road = this.cityMap.roads.find((candidate) =>
        candidate.roadClass === 'arterial' &&
        candidate.isVertical === (ai.roadType === 'vertical') &&
        Math.abs((ai.roadType === 'vertical' ? candidate.x1 : candidate.y1) - ai.roadCoord) < 1
      );
      if (!road) return undefined;
      const along = road.points.map((point) => (ai.roadType === 'vertical' ? point.y : point.x));
      extent = { min: Math.min(...along), max: Math.max(...along), halfWidth: road.width / 2, lanesPerDirection: road.lanesPerDirection };
      this.arterialExtents.set(key, extent);
    }
    return extent;
  }

  /** Distance left to the capped end of the arterial in the car's direction of travel. */
  private getRoadEndDistance(car: VehicleInstance, ai: NPCAIExtra) {
    const extent = this.getArterialExtent(ai);
    if (!extent) return undefined;
    const position = ai.roadType === 'vertical' ? car.y : car.x;
    return ai.direction === 'south' || ai.direction === 'east'
      ? extent.max - position
      : position - extent.min;
  }

  /**
   * Turn around at a capped arterial end on a U-shaped Bezier into the
   * opposite lane. Flipping `direction` alone left the lane-keeping
   * controller to improvise the arc: it swung wide off the asphalt, and
   * while the car still faced its old heading the spacing pass misread
   * which car was in front and shoved queued cars past the road end.
   * Running it as a turn keeps the arc on the road and makes the spacing
   * pass treat the car as manoeuvring.
   */
  /** Geometry of a road-end U-turn into the opposite lane from the car's current spot. */
  private planRoadEndUTurn(car: VehicleInstance, ai: NPCAIExtra) {
    const targetDirection: TrafficDirection = ai.direction === 'north' ? 'south'
      : ai.direction === 'south' ? 'north'
      : ai.direction === 'west' ? 'east'
      : 'west';
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, targetDirection, ai.laneIndex);
    const endPos = ai.roadType === 'vertical' ? { x: lane.x!, y: car.y } : { x: car.x, y: lane.y! };
    const forwardX = Math.cos(car.angle);
    const forwardY = Math.sin(car.angle);
    const toEndX = endPos.x - car.x;
    const toEndY = endPos.y - car.y;
    // Rotate toward the side the opposite lane is on (+angle turns right
    // in screen space, where y points down).
    const turnSign = toEndX * -forwardY + toEndY * forwardX >= 0 ? 1 : -1;
    // The arc's furthest point is half the control point's reach.
    const controlPos = {
      x: (car.x + endPos.x) / 2 + forwardX * ROAD_END_UTURN_REACH * 2,
      y: (car.y + endPos.y) / 2 + forwardY * ROAD_END_UTURN_REACH * 2,
    };
    return { targetDirection, startPos: { x: car.x, y: car.y }, endPos, controlPos, turnSign };
  }

  /**
   * A U-turn crosses the opposite lane, so - like a real driver - only start
   * it when nothing is on or near the arc. Swinging into an occupied lane
   * shoved the car waiting there off the asphalt.
   */
  private isRoadEndUTurnClear(car: VehicleInstance, plan: ReturnType<TrafficAI['planRoadEndUTurn']>) {
    for (const t of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
      const u = 1 - t;
      // The body itself, posed along the arc, must clear everyone.
      const pose: BodyPose = {
        x: u * u * plan.startPos.x + 2 * u * t * plan.controlPos.x + t * t * plan.endPos.x,
        y: u * u * plan.startPos.y + 2 * u * t * plan.controlPos.y + t * t * plan.endPos.y,
        angle: car.angle + plan.turnSign * Math.PI * t,
        type: car.type,
      };
      const blocked = this.npcVehicles.some((other) =>
        other.id !== car.id && other.health > 0 &&
        Math.hypot(other.x - pose.x, other.y - pose.y) < 160 &&
        getBodyClearance(pose, other) < 8
      );
      if (blocked) return false;
    }
    return true;
  }

  /**
   * Turn around at a capped arterial end on a U-shaped Bezier into the
   * opposite lane. Flipping `direction` alone left the lane-keeping
   * controller to improvise the arc: it swung wide off the asphalt, and
   * while the car still faced its old heading the spacing pass misread
   * which car was in front and shoved queued cars past the road end.
   * Running it as a turn keeps the arc on the road and makes the spacing
   * pass treat the car as manoeuvring.
   */
  private beginRoadEndUTurn(car: VehicleInstance, ai: NPCAIExtra, plan: ReturnType<TrafficAI['planRoadEndUTurn']>) {
    ai.isTurning = true;
    ai.isUTurn = true;
    ai.turnProgress = 0;
    ai.turnStartPos = plan.startPos;
    ai.turnEndPos = plan.endPos;
    ai.turnControlPos = plan.controlPos;
    ai.turnStartAngle = car.angle;
    // Just short of pi so the interpolation keeps the chosen turn side.
    ai.turnTargetAngle = car.angle + plan.turnSign * (Math.PI - 1e-3);
    ai.targetRoadCoord = ai.roadCoord;
    ai.targetDirection = plan.targetDirection;
    car.turnSignal = plan.turnSign > 0 ? 'right' : 'left';
  }

  /**
   * Commit to one swerve toward the kerb for a vehicle coming head-on in
   * this car's lane. Real drivers brake hard and steer for the shoulder,
   * never into oncoming traffic, and do not change their minds mid-swerve;
   * re-choosing a side every frame is what made the old bypass orbit the
   * player. Returns false when there is no room, leaving braking alone.
   */
  private beginEvasion(car: VehicleInstance, ai: NPCAIExtra, threat: VehicleInstance) {
    const extent = this.getArterialExtent(ai);
    if (!extent) return false;
    const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
    const kerbSide = Math.sign(laneCoord - ai.roadCoord) || 1;
    // Room between the lane centre and the kerb, keeping the whole body on
    // the asphalt.
    const room = extent.halfWidth - Math.abs(laneCoord - ai.roadCoord) - config.width / 2 - 6;
    const shift = Math.min(room, config.width * 1.6);
    if (shift < config.width * 0.5) return false;
    const offset = kerbSide * shift;

    // The kerb-side path must be free of other traffic (parked cars, a
    // neighbouring lane) along the stretch the swerve covers.
    const forwardX = Math.cos(lane.angle);
    const forwardY = Math.sin(lane.angle);
    const along = ai.roadType === 'vertical' ? car.y : car.x;
    for (const ahead of [0, 40, 80, 120]) {
      const point = ai.roadType === 'vertical'
        ? { x: laneCoord + offset, y: along + forwardY * ahead }
        : { x: along + forwardX * ahead, y: laneCoord + offset };
      const blocked = this.npcVehicles.some((other) => {
        if (other.id === car.id || other.id === threat.id || other.health <= 0) return false;
        const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
        return Math.hypot(other.x - point.x, other.y - point.y) < (config.length + otherConfig.length) * 0.5 + 8;
      });
      if (blocked) return false;
    }

    ai.laneShift = { kind: 'evade', targetId: threat.id, offset, released: false };
    TrafficAI.honk(car, 600);
    return true;
  }

  /**
   * Drive along the lane while shifting sideways toward the lane-shift offset
   * (or back to the lane centre once released). The sideways step is bounded
   * by forward travel times MAX_LANE_SHIFT_SLOPE and the heading follows the
   * actual path, so the car steers like a car: no sliding when stopped and
   * no spinning on the spot.
   */
  private driveLaneShift(car: VehicleInstance, ai: NPCAIExtra, delta: number) {
    const shift = ai.laneShift!;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
    const current = ai.roadType === 'vertical' ? car.x : car.y;
    let target = laneCoord + (shift.released ? 0 : shift.offset);
    if (shift.released && this.isLaneOccupiedAlongside(car, ai)) {
      // Someone is beside us in the lane we are returning to: hold the
      // offset until they have gone by instead of merging into them.
      target = current;
    }
    const forwardStep = Math.max(0, car.speed) * 60 * delta;
    const maxLateral = forwardStep * MAX_LANE_SHIFT_SLOPE;
    const lateralStep = Math.max(-maxLateral, Math.min(maxLateral, target - current));
    const forwardX = Math.cos(lane.angle);
    const forwardY = Math.sin(lane.angle);
    const moveX = forwardX * forwardStep + (ai.roadType === 'vertical' ? lateralStep : 0);
    const moveY = forwardY * forwardStep + (ai.roadType === 'vertical' ? 0 : lateralStep);
    car.x += moveX;
    car.y += moveY;
    if (Math.hypot(moveX, moveY) > 0.05) car.angle = Math.atan2(moveY, moveX);
    // Reversing: straight back along the current heading.
    if (car.speed < 0) {
      car.x += Math.cos(car.angle) * car.speed * 60 * delta;
      car.y += Math.sin(car.angle) * car.speed * 60 * delta;
    }
    if (shift.released && Math.abs(target - (ai.roadType === 'vertical' ? car.x : car.y)) < 0.5) {
      ai.laneShift = undefined;
      car.angle = lane.angle;
      car.turnSignal = 'none';
    }
  }

  /** Indicator for a sideways shift: the driver's right is (-sin, cos) of the heading in screen space. */
  private getShiftSignal(ai: NPCAIExtra, offset: number): 'left' | 'right' {
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const rightAxis = ai.roadType === 'vertical' ? -Math.sin(lane.angle) : Math.cos(lane.angle);
    return offset * rightAxis > 0 ? 'right' : 'left';
  }

  /**
   * The lane centre is taken within a body length ahead or behind, or a car
   * coming up from behind would reach us before we finish merging.
   */
  private isLaneOccupiedAlongside(car: VehicleInstance, ai: NPCAIExtra) {
    const carConfig = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
    return this.npcVehicles.some((other) => {
      if (other.id === car.id || other.health <= 0) return false;
      const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
      const { along } = this.getLaneRelation(car, ai, other);
      const otherAcross = ai.roadType === 'vertical' ? other.x : other.y;
      const closingFromBehind = along < 0 ? Math.max(0, other.speed - car.speed) * 60 * 1.5 : 0;
      return along > -((carConfig.length + otherConfig.length) / 2 + 10 + closingFromBehind) &&
        along < (carConfig.length + otherConfig.length) / 2 + 10 &&
        Math.abs(otherAcross - laneCoord) < (carConfig.width + otherConfig.width) / 2 + 2;
    });
  }

  /**
   * Mirror check: a vehicle behind in the corridor at `targetAcross` that
   * would reach us within a couple of seconds at its closing speed.
   */
  private isCorridorThreatFromBehind(car: VehicleInstance, ai: NPCAIExtra, targetAcross: number, playerVehicle?: VehicleInstance | null) {
    const carConfig = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const vehicles = playerVehicle ? [...this.npcVehicles, playerVehicle] : this.npcVehicles;
    return vehicles.some((other) => {
      if (other.id === car.id || other.health <= 0) return false;
      const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
      const { along } = this.getLaneRelation(car, ai, other);
      if (along >= (carConfig.length + otherConfig.length) / 2) return false;
      const otherAcross = ai.roadType === 'vertical' ? other.x : other.y;
      if (Math.abs(otherAcross - targetAcross) >= (carConfig.width + otherConfig.width) / 2 + 4) return false;
      const closing = Math.max(0, Math.abs(other.speed) - Math.max(0, car.speed));
      return along > -((carConfig.length + otherConfig.length) / 2 + 20 + closing * 60 * 2);
    });
  }

  /** Position of `other` in this car's lane frame: along the lane and across it. */
  private getLaneRelation(car: VehicleInstance, ai: NPCAIExtra, other: VehicleInstance) {
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const forwardX = Math.cos(lane.angle);
    const forwardY = Math.sin(lane.angle);
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    return {
      along: dx * forwardX + dy * forwardY,
      across: ai.roadType === 'vertical' ? other.x - car.x : other.y - car.y,
    };
  }

  /** True when two vehicles' bodies overlap across the lane (would collide if aligned). */
  private overlapsAcross(car: VehicleInstance, ai: NPCAIExtra, other: VehicleInstance, margin = 2) {
    const carConfig = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
    const { across } = this.getLaneRelation(car, ai, other);
    return Math.abs(across) < (carConfig.width + otherConfig.width) / 2 + margin;
  }

  /**
   * Plan a pass around a stopped vehicle in this car's lane: the side with a
   * clear corridor that stays on the asphalt. The pass itself is a lane
   * shift, so the car steers out on a real curve instead of chasing
   * waypoints it cannot physically reach - the old waypoint bypass put its
   * first point straight beside the car, which a car with a turning radius
   * can only circle, and stopped for good whenever it came within a
   * centre-to-centre safe gap of the obstacle, which passing alongside always
   * does.
   */
  private startBypass(car: VehicleInstance, ai: NPCAIExtra, obstacle: VehicleInstance, playerVehicle?: VehicleInstance | null) {
    if (ai.laneShift || ai.groundBypass || ai.isTurning) return false;
    if (Math.abs(obstacle.speed) > 1) return false;
    // Overtake a stopped player, or an NPC stopped for no traffic reason -
    // never a car simply waiting its turn in a queue or at a light.
    if (!obstacle.isPlayer && this.aiData.get(obstacle.id)?.holding) return false;

    // Only one NPC may pull out around obstacles on a road segment at a time,
    // so two passes never converge on the same gap.
    const competing = this.npcVehicles.some((other) => {
      if (other.id === car.id || other.health <= 0 || other.isCrashed) return false;
      const otherAi = this.aiData.get(other.id);
      return Boolean(
        otherAi?.laneShift?.kind === 'bypass' && !otherAi.laneShift.released &&
          otherAi.roadType === ai.roadType &&
          otherAi.roadCoord === ai.roadCoord &&
          otherAi.direction === ai.direction &&
          Math.hypot(other.x - car.x, other.y - car.y) < 260
      );
    });
    if (competing) return false;

    const extent = this.getArterialExtent(ai);
    if (!extent) return false;
    const carConfig = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const obstacleConfig = VEHICLE_CONFIGS[obstacle.type] || VEHICLE_CONFIGS.sedan;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
    const obstacleAcross = ai.roadType === 'vertical' ? obstacle.x : obstacle.y;
    const clearance = (carConfig.width + obstacleConfig.width) / 2 + 10;
    const { along: obstacleAlong } = this.getLaneRelation(car, ai, obstacle);
    const passEnd = obstacleAlong + (carConfig.length + obstacleConfig.length) / 2 + 40;
    const forwardX = Math.cos(lane.angle);
    const forwardY = Math.sin(lane.angle);
    const vehicles = playerVehicle ? [...this.npcVehicles, playerVehicle] : this.npcVehicles;

    const options = ([-1, 1] as const).map((side) => {
      const targetAcross = obstacleAcross + side * clearance;
      const onAsphalt = Math.abs(targetAcross - ai.roadCoord) <= extent.halfWidth - carConfig.width / 2 - 4;
      // Pass on this direction's own carriageway, never across the centre
      // line: the corridor check is a snapshot, and oncoming traffic closes
      // on a car in its lane faster than any pass completes.
      const ownCarriageway = Math.sign(targetAcross - ai.roadCoord) === Math.sign(laneCoord - ai.roadCoord) &&
        Math.abs(targetAcross - ai.roadCoord) >= carConfig.width / 2 + 2;
      let freeSpace = Infinity;
      for (let along = 0; along <= passEnd; along += 30) {
        const point = ai.roadType === 'vertical'
          ? { x: targetAcross, y: car.y + forwardY * along }
          : { x: car.x + forwardX * along, y: targetAcross };
        for (const other of vehicles) {
          if (other.id === car.id || other.id === obstacle.id || other.health <= 0) continue;
          const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
          const room = Math.hypot(other.x - point.x, other.y - point.y) - (carConfig.length + otherConfig.length) / 2 - 6;
          freeSpace = Math.min(freeSpace, room);
        }
      }
      const mirrorClear = !this.isCorridorThreatFromBehind(car, ai, targetAcross, playerVehicle);
      return { side, offset: targetAcross - laneCoord, onAsphalt: onAsphalt && ownCarriageway && mirrorClear, freeSpace };
    });

    const selected = options
      .filter((option) => option.onAsphalt && option.freeSpace >= 0)
      .sort((first, second) => second.freeSpace - first.freeSpace)[0];
    if (!selected) return false;

    ai.laneShift = { kind: 'bypass', targetId: obstacle.id, offset: selected.offset, released: false };
    ai.progressTimer = 0;
    ai.stuckTimer = 0;
    car.turnSignal = this.getShiftSignal(ai, selected.offset);
    return true;
  }

  /**
   * Speed and gear for an active bypass. Returns a speed cap, or 'reverse'
   * when the car must back up for room to pull out.
   */
  private controlBypass(
    car: VehicleInstance,
    ai: NPCAIExtra,
    cruiseSpeed: number,
    playerVehicle?: VehicleInstance | null
  ): number | 'reverse' {
    const shift = ai.laneShift!;
    const obstacle = (playerVehicle && playerVehicle.id === shift.targetId)
      ? playerVehicle
      : this.npcVehicles.find((candidate) => candidate.id === shift.targetId);
    const carConfig = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    if (!obstacle || obstacle.health <= 0 || Math.abs(obstacle.speed) > 2) {
      shift.released = true;
      shift.reversing = false;
      return cruiseSpeed;
    }
    const obstacleConfig = VEHICLE_CONFIGS[obstacle.type] || VEHICLE_CONFIGS.sedan;
    const { along } = this.getLaneRelation(car, ai, obstacle);
    const halfLengths = (carConfig.length + obstacleConfig.length) / 2;
    if (along < -(halfLengths + 20)) {
      // Rear bumper is clear of the obstacle's front: merge back.
      shift.released = true;
      shift.reversing = false;
      return cruiseSpeed;
    }

    const passSpeed = Math.max(3, Math.min(6.5, cruiseSpeed * 0.55));
    // Still mostly in our own lane and someone is coming up fast in the
    // corridor we are moving into: call the pass off and stay put.
    const laneForShift = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const laneCoordForShift = ai.roadType === 'vertical' ? laneForShift.x! : laneForShift.y!;
    const acrossNow = ai.roadType === 'vertical' ? car.x : car.y;
    if (
      Math.abs(acrossNow - laneCoordForShift) < Math.abs(shift.offset) / 2 &&
      this.isCorridorThreatFromBehind(car, ai, laneCoordForShift + shift.offset, playerVehicle)
    ) {
      shift.released = true;
      shift.reversing = false;
      car.turnSignal = 'none';
      return 0;
    }
    if (!this.overlapsAcross(car, ai, obstacle)) {
      shift.reversing = false;
      return passSpeed;
    }

    // Still overlapping across the lane: the nose must not reach the
    // obstacle before the shift has cleared it. Lateral travel comes only
    // from forward travel, so the room needed is the remaining sideways
    // distance divided by the shift slope.
    const current = ai.roadType === 'vertical' ? car.x : car.y;
    const obstacleAcross = ai.roadType === 'vertical' ? obstacle.x : obstacle.y;
    const needAcross = (carConfig.width + obstacleConfig.width) / 2 + 2 - Math.abs(current - obstacleAcross);
    const neededRoom = Math.max(0, needAcross) / MAX_LANE_SHIFT_SLOPE + 6;
    const bumperGap = along - halfLengths;

    if (shift.reversing || (bumperGap < neededRoom && Math.abs(car.speed) < 0.3)) {
      if (bumperGap >= neededRoom) {
        shift.reversing = false;
        return 0;
      }
      // Back up only on asphalt and only if the lane behind is clear.
      const extent = this.getArterialExtent(ai);
      const position = ai.roadType === 'vertical' ? car.y : car.x;
      const roadBehind = !extent ? 0 : (ai.direction === 'south' || ai.direction === 'east')
        ? position - extent.min
        : extent.max - position;
      const behindClear = roadBehind > carConfig.length / 2 + 30 && !this.npcVehicles.some((other) => {
        if (other.id === car.id || other.health <= 0) return false;
        const relation = this.getLaneRelation(car, ai, other);
        const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
        return relation.along < 0 &&
          relation.along > -((carConfig.length + otherConfig.length) / 2 + 30) &&
          Math.abs(relation.across) < (carConfig.width + otherConfig.width) / 2 + 4;
      });
      if (!behindClear) {
        // Boxed in: give up on the pass and queue normally.
        ai.laneShift = undefined;
        car.turnSignal = 'none';
        return 0;
      }
      shift.reversing = true;
      return 'reverse';
    }
    return Math.min(passSpeed, getStoppingCurveSpeed(carConfig, bumperGap - 4));
  }

  /** Any vehicle in or overlapping the kerbside bay this car is heading for. */
  private isParkingBayOccupied(car: VehicleInstance, ai: NPCAIExtra, bayOffset: number) {
    if (ai.parkingCoordinate === undefined) return false;
    const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const bayAcross = (ai.roadType === 'vertical' ? lane.x! : lane.y!) + bayOffset;
    const bay = ai.roadType === 'vertical'
      ? { x: bayAcross, y: ai.parkingCoordinate }
      : { x: ai.parkingCoordinate, y: bayAcross };
    return this.npcVehicles.some((other) => {
      if (other.id === car.id || other.health <= 0) return false;
      const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
      const along = ai.roadType === 'vertical' ? Math.abs(other.y - bay.y) : Math.abs(other.x - bay.x);
      const across = ai.roadType === 'vertical' ? Math.abs(other.x - bay.x) : Math.abs(other.y - bay.y);
      return along < (config.length + otherConfig.length) / 2 + 10 && across < (config.width + otherConfig.width) / 2 + 4;
    });
  }

  /** Shift from the lane centre to a kerbside bay: tight against the kerb, body just on the asphalt. */
  private getParkingBayOffset(car: VehicleInstance, ai: NPCAIExtra) {
    const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const extent = this.getArterialExtent(ai);
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
    // Kerb on this car's own side of the road it is on now.
    const side = Math.sign(laneCoord - ai.roadCoord) || 1;
    const bayCentre = ai.roadCoord + side * ((extent?.halfWidth ?? 110) - config.width / 2 - 2);
    return bayCentre - laneCoord;
  }

  private beginParking(car: VehicleInstance, ai: NPCAIExtra) {
    ai.activity = 'parked';
    ai.parkingTimer = 8 + (Number(car.id.replace(/\D/g, '')) % 5);
    ai.parkingPassengers = 1 + (Number(car.id.replace(/\D/g, '')) % 2);
    ai.abandonAfterParking = Number(car.id.replace(/\D/g, '')) % 7 === 0;
    ai.parkingCoordinate = undefined;
    ai.driveTimer = 0;
    ai.nextParkingIn = 30 + (Number(car.id.replace(/\D/g, '')) % 6) * 8;
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    // The car has already pulled into the bay (see the 'park' lane shift);
    // it stays where it stopped instead of being teleported sideways.
    car.angle = lane.angle;
    ai.laneShift = undefined;
    car.turnSignal = 'none';
    car.speed = 0;
    car.isBraking = true;
    car.npcParked = true;

    const side = ai.roadType === 'vertical' ? this.sidewalkOffset : this.sidewalkOffset;
    const exitX = ai.roadType === 'vertical' ? lane.x! + side * (ai.parkingSide || 1) : car.x;
    const exitY = ai.roadType === 'vertical' ? car.y : lane.y! + side * (ai.parkingSide || 1);
    this.pedestrians.push({
      id: `parking_driver_${car.id}_${Math.floor(performance.now())}`,
      x: car.x,
      y: car.y,
      angle: Math.atan2(exitY - car.y, exitX - car.x),
      speed: 1.5,
      targetX: exitX,
      targetY: exitY,
      state: 'leaving',
      health: 100,
      skinColor: '#fed7aa',
      shirtColor: '#2563eb',
      pantsColor: '#1e293b',
      speechTimer: 0,
      ragdollTimer: 0,
      vx: 0,
      vy: 0,
      vehicleId: car.id,
      parkingRole: 'exiting',
      parkingTimer: 1.5,
    });
    for (let i = 0; i < (ai.parkingPassengers || 0); i += 1) {
      this.pedestrians.push({
        id: `parking_passenger_${car.id}_${i}_${Math.floor(performance.now())}`,
        x: exitX + (i + 1) * 18,
        y: exitY,
        angle: Math.atan2(car.y - exitY, car.x - exitX),
        speed: 1.35,
        targetX: car.x,
        targetY: car.y,
        state: 'walking',
        health: 100,
        skinColor: '#fde047',
        shirtColor: '#10b981',
        pantsColor: '#334155',
        speechTimer: 0,
        ragdollTimer: 0,
        vx: 0,
        vy: 0,
        vehicleId: car.id,
        parkingRole: 'entering',
        parkingTimer: 0,
      });
    }
  }

  private getBuildingEntrance(buildingId: string, roadType: 'vertical' | 'horizontal', roadCoord: number, side: number) {
    const building = this.cityMap.buildings.find((candidate) => candidate.id === buildingId);
    if (!building) return null;
    const sign = side >= 0 ? 1 : -1;
    if (roadType === 'vertical') {
      return {
        sidewalkX: roadCoord + side,
        sidewalkY: Math.max(120, Math.min(WORLD_SIZE - 120, building.y)),
        doorX: building.x - sign * (building.width / 2 + 8),
        doorY: Math.max(building.y - building.height / 2 + 16, Math.min(building.y + building.height / 2 - 16, building.y)),
      };
    }
    return {
      sidewalkX: Math.max(120, Math.min(WORLD_SIZE - 120, building.x)),
      sidewalkY: roadCoord + side,
      doorX: Math.max(building.x - building.width / 2 + 16, Math.min(building.x + building.width / 2 - 16, building.x)),
      doorY: building.y - sign * (building.height / 2 + 8),
    };
  }

  /** True when the straight segment runs over the drivable surface of any road. */
  private pathCrossesRoad(fromX: number, fromY: number, toX: number, toY: number) {
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 30));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const clearance = this.cityMap.clearanceToRoads({
        x: fromX + (toX - fromX) * t,
        y: fromY + (toY - fromY) * t,
        width: 0,
        height: 0,
      });
      if (clearance < -8) return true;
    }
    return false;
  }

  private assignBuildingTrip(ped: Pedestrian) {
    if (this.cityMap.buildings.length === 0) return false;
    const seed = Number(ped.id.replace(/\D/g, '')) || 0;
    const roadType = ped.walkRoadType || 'vertical';
    const roadCoord = ped.walkRoadCoord ?? (roadType === 'vertical' ? this.gridX[0] : this.gridY[0]);
    const side = ped.walkSide ?? this.sidewalkOffset;

    // A resident can only enter a building from the sidewalk side they are
    // already walking on, and only one they can reach without crossing a road.
    // Candidates are the nearest buildings (rotated by id so residents do not
    // all pick the same one), not a random building anywhere on the map.
    const candidates = this.cityMap.buildings
      .filter((building) => (roadType === 'vertical'
        ? (building.x - roadCoord) * side
        : (building.y - roadCoord) * side) > 0)
      .map((building) => ({ building, distance: Math.hypot(building.x - ped.x, building.y - ped.y) }))
      .filter((candidate) => candidate.distance <= 500)
      .sort((first, second) => first.distance - second.distance)
      .slice(0, 8);

    for (let offset = 0; offset < candidates.length; offset += 1) {
      const { building } = candidates[(seed + offset) % candidates.length];
      const entrance = this.getBuildingEntrance(building.id, roadType, roadCoord, side);
      if (!entrance) continue;
      // The building can be near yet have other roads in between.
      if (this.pathCrossesRoad(ped.x, ped.y, entrance.sidewalkX, entrance.sidewalkY)
        || this.pathCrossesRoad(entrance.sidewalkX, entrance.sidewalkY, entrance.doorX, entrance.doorY)) continue;
      ped.buildingId = building.id;
      ped.lifeStage = 'toSidewalk';
      ped.targetX = entrance.sidewalkX;
      ped.targetY = entrance.sidewalkY;
      return true;
    }
    return false;
  }

  private readonly pedestrianCrossingCache = new Map<string, number[]>();

  /**
   * Coordinates along a pedestrian's walking axis where a road cuts across the
   * sidewalk line. The arterial grid alone is not enough: the ring road,
   * access roads and country routes are polylines that also cross sidewalks,
   * and walkers used to stroll straight across them.
   */
  private pedestrianCrossings(ped: Pedestrian, axis: 'vertical' | 'horizontal') {
    const grid = axis === 'vertical' ? this.gridY : this.gridX;
    const line = (ped.walkRoadCoord ?? (axis === 'vertical' ? ped.x : ped.y)) + (ped.walkSide ?? 0);
    const key = `${axis}:${Math.round(line)}`;
    const cached = this.pedestrianCrossingCache.get(key);
    if (cached) return cached;

    const crossings = [...grid];
    for (const road of this.cityMap.roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const sideA = (axis === 'vertical' ? a.x : a.y) - line;
        const sideB = (axis === 'vertical' ? b.x : b.y) - line;
        if (sideA * sideB >= 0) continue; // parallel to, or entirely on one side of, the sidewalk
        const t = sideA / (sideA - sideB);
        const at = axis === 'vertical' ? a.y + (b.y - a.y) * t : a.x + (b.x - a.x) * t;
        // The arterial that defines this crossing is already in the grid list.
        if (crossings.every((known) => Math.abs(known - at) > 60)) crossings.push(at);
      }
    }
    crossings.sort((first, second) => first - second);
    this.pedestrianCrossingCache.set(key, crossings);
    return crossings;
  }

  private getPedestrianAxisBounds(value: number, crossingRoads: number[]) {
    let lower = 100;
    let upper = WORLD_SIZE - 100;
    for (const road of crossingRoads) {
      if (value < road) {
        upper = Math.min(upper, road - this.sidewalkOffset);
        break;
      }
      lower = Math.max(lower, road + this.sidewalkOffset);
    }

    // If a legacy save placed a pedestrian in the 220px crossing buffer,
    // return a safe side of that road instead of allowing a new target to
    // perpetuate the invalid position.
    if (lower > upper) {
      const road = crossingRoads.reduce((nearest, candidate) =>
        Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest
      );
      return value < road
        ? { lower: Math.max(100, road - this.sidewalkOffset - 60), upper: road - this.sidewalkOffset }
        : { lower: road + this.sidewalkOffset, upper: Math.min(WORLD_SIZE - 100, road + this.sidewalkOffset + 60) };
    }
    return { lower, upper };
  }

  private beginPedestrianCrosswalk(ped: Pedestrian, destination: number, direction: -1 | 1) {
    const axis = ped.walkRoadType || 'vertical';
    const roadCoord = ped.walkRoadCoord ?? (axis === 'vertical' ? this.gridX[0] : this.gridY[0]);
    const crossingRoad = destination + direction * this.sidewalkOffset;
    const inter = this.cityMap.intersections.find((candidate) =>
      candidate.trafficControlled !== false && (axis === 'vertical'
        ? Math.abs(candidate.x - roadCoord) < 20 && Math.abs(candidate.y - crossingRoad) < 20
        : Math.abs(candidate.y - roadCoord) < 20 && Math.abs(candidate.x - crossingRoad) < 20)
    );
    if (!inter) return false;

    const lightDirection = axis === 'vertical' ? 'east' : 'north';
    const light = this.cityMap.trafficLights.find((candidate) =>
      candidate.intersectionId === inter.id && candidate.direction === lightDirection
    );
    if (!light) return false;

    const side = ped.walkSide ?? this.sidewalkOffset;
    const crossOffset = Math.min(this.sidewalkOffset, inter.size / 2 + CROSSWALK_DEPTH / 2);
    const farSide = crossingRoad + direction * this.sidewalkOffset;
    const crosswalk = axis === 'vertical'
      ? inter.x + Math.sign(side) * crossOffset
      : inter.y + Math.sign(side) * crossOffset;
    ped.crosswalk = {
      signalId: light.id,
      waypointIndex: 0,
      waypoints: axis === 'vertical'
        ? [
            { x: crosswalk, y: destination },
            { x: crosswalk, y: farSide },
            { x: roadCoord + side, y: farSide },
          ]
        : [
            { x: destination, y: crosswalk },
            { x: farSide, y: crosswalk },
            { x: farSide, y: roadCoord + side },
          ],
    };
    ped.state = 'waiting';
    return true;
  }

  private updatePedestrianCrosswalk(ped: Pedestrian, delta: number) {
    const crossing = ped.crosswalk;
    if (!crossing) return false;

    if (ped.state === 'waiting') {
      const signal = this.cityMap.trafficLights.find((light) => light.id === crossing.signalId);
      if (signal?.pedestrianState !== 'walk') return true;
      ped.state = 'walking';
    }

    const waypoint = crossing.waypoints[crossing.waypointIndex];
    if (!waypoint) {
      ped.crosswalk = undefined;
      ped.state = 'walking';
      this.choosePedestrianWaypoint(ped);
      return true;
    }

    const dx = waypoint.x - ped.x;
    const dy = waypoint.y - ped.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 8) {
      crossing.waypointIndex += 1;
      return true;
    }
    const step = Math.min(distance, ped.speed * 60 * delta);
    ped.angle = Math.atan2(dy, dx);
    ped.x += (dx / distance) * step;
    ped.y += (dy / distance) * step;
    return true;
  }

  private getIntersectionApproachDistance(
    car: VehicleInstance,
    ai: NPCAIExtra,
    inter: Intersection
  ): number | null {
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);

    if (ai.roadType === 'vertical') {
      if (Math.abs(inter.x - ai.roadCoord) > 70) return null;
      if (Math.abs(car.x - lane.x!) > 52) return null;
      return ai.direction === 'south' ? inter.y - car.y : car.y - inter.y;
    }

    if (Math.abs(inter.y - ai.roadCoord) > 70) return null;
    if (Math.abs(car.y - lane.y!) > 52) return null;
    return ai.direction === 'east' ? inter.x - car.x : car.x - inter.x;
  }

  /**
   * Straight-line closing speed between two vehicles, in the same units and
   * formula physics.ts uses to decide whether an impact is a "hard" one. AI
   * gap-keeping below uses this to step aside for a genuine ram instead of
   * teleporting the NPC clear of a collision the player was trying to make.
   */
  private static honk(car: VehicleInstance, durationMs: number) {
    if (car.isHonking) return;
    car.isHonking = true;
    setTimeout(() => { car.isHonking = false; }, durationMs);
  }

  private static isClosingFast(mover: VehicleInstance, target: VehicleInstance, threshold = 5.5) {
    const dx = target.x - mover.x;
    const dy = target.y - mover.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return Math.abs(mover.speed) > threshold;
    const vx = Math.cos(mover.angle) * mover.speed;
    const vy = Math.sin(mover.angle) * mover.speed;
    // Velocity component along the line to the target - not raw relative
    // speed, which would also flag a fast NPC closing on a stationary
    // player (normal queueing) as a "ram". This only fires when the mover
    // itself is driving toward the target.
    return (vx * dx + vy * dy) / dist > threshold;
  }

  private getActiveIntersection(car: VehicleInstance, ai: NPCAIExtra) {
    if (ai.isTurning && ai.lastIntersectionId) {
      const turningIntersection = this.cityMap.intersections.find((inter) => inter.id === ai.lastIntersectionId);
      if (turningIntersection) return { inter: turningIntersection, approachDistance: 0 };
    }

    let active: { inter: Intersection; approachDistance: number } | null = null;
    for (const inter of this.cityMap.intersections) {
      if (inter.trafficControlled === false) continue;
      const approachDistance = this.getIntersectionApproachDistance(car, ai, inter);
      if (approachDistance === null || approachDistance < -120 || approachDistance > 190) continue;
      if (!active || Math.abs(approachDistance) < Math.abs(active.approachDistance)) {
        active = { inter, approachDistance };
      }
    }
    return active;
  }

  private startGroundBypass(car: VehicleInstance, ai: NPCAIExtra, inter: Intersection) {
    if (ai.groundBypass || ai.isTurning) return false;

    // The ground detour is a narrow temporary lane. Serializing it per
    // junction prevents two queues from entering the same corridor and being
    // pushed around by the spacing solver.
    const anotherBypass = this.npcVehicles.some((candidate) => {
      if (candidate.id === car.id || candidate.health <= 0 || candidate.isCrashed) return false;
      return this.aiData.get(candidate.id)?.groundBypass?.intersectionId === inter.id;
    });
    if (anotherBypass) return false;

    const forwardX = Math.cos(car.angle);
    const forwardY = Math.sin(car.angle);
    const lateralX = -forwardY;
    const lateralY = forwardX;
    const side = car.id.charCodeAt(car.id.length - 1) % 2 === 0 ? 1 : -1;
    const detourOffset = 112;
    const pastIntersection = inter.size / 2 + 112;
    const sidePoint = {
      x: car.x + lateralX * side * detourOffset + forwardX * 18,
      y: car.y + lateralY * side * detourOffset + forwardY * 18,
    };
    const pastPoint = {
      x: inter.x + forwardX * pastIntersection + lateralX * side * detourOffset,
      y: inter.y + forwardY * pastIntersection + lateralY * side * detourOffset,
    };
    const targetLane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
    const rejoinPoint = ai.roadType === 'vertical'
      ? { x: targetLane.x!, y: pastPoint.y }
      : { x: pastPoint.x, y: targetLane.y! };

    ai.groundBypass = {
      intersectionId: inter.id,
      waypoints: [sidePoint, pastPoint, rejoinPoint],
      waypointIndex: 0,
    };
    // This car is deliberately leaving the conflict zone instead of crossing
    // it normally. Keeping its old reservation until the five-second cleanup
    // timeout makes every perpendicular approach wait behind a car that is
    // already clearing the junction, which turns a single obstruction into a
    // visible gridlock.
    if (this.intersectionReservations.get(inter.id) === car.id) {
      this.intersectionReservations.delete(inter.id);
      this.intersectionReservationAge.delete(inter.id);
    }
    ai.progressTimer = 0;
    ai.stuckTimer = 0;
    car.isBraking = false;
    car.turnSignal = 'hazard';
    return true;
  }

  private updateGroundBypass(car: VehicleInstance, ai: NPCAIExtra, delta: number, cruiseSpeed: number) {
    const bypass = ai.groundBypass;
    if (!bypass) return false;

    const waypoint = bypass.waypoints[bypass.waypointIndex];
    if (!waypoint) {
      ai.groundBypass = undefined;
      car.turnSignal = 'none';
      car.angle = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex).angle;
      car.speed = cruiseSpeed * 0.7;
      return false;
    }

    const dx = waypoint.x - car.x;
    const dy = waypoint.y - car.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 14) {
      bypass.waypointIndex += 1;
      return true;
    }

    const bypassSpeed = Math.min(7.5, Math.max(5.5, cruiseSpeed * 0.55));
    // The detour runs off the lanes, where no queue logic protects it: stop
    // for anything in the way instead of driving through it.
    // Look as far along the path as it takes to stop from this speed.
    const carConfig = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const stoppingDistance = (60 * Math.max(0, car.speed) ** 2) / (2 * carConfig.braking);
    const lookAhead = Math.min(distance, Math.max(40, stoppingDistance + 30));
    const pathBlocked = this.npcVehicles.some((other) => {
      if (other.id === car.id || other.health <= 0) return false;
      const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
      const reach = (carConfig.length + otherConfig.length) / 2 + 6;
      for (let ahead = 10; ahead <= lookAhead; ahead += 15) {
        const probe = { x: car.x + (dx / distance) * ahead, y: car.y + (dy / distance) * ahead };
        if (Math.hypot(other.x - probe.x, other.y - probe.y) < reach) return true;
      }
      return false;
    });
    if (pathBlocked) {
      car.speed = integrateVehicleSpeed(car.speed, carConfig, { brake: true }, delta);
      car.isBraking = true;
      car.x += Math.cos(car.angle) * car.speed * 60 * delta;
      car.y += Math.sin(car.angle) * car.speed * 60 * delta;
      return true;
    }
    const desiredAngle = Math.atan2(dy, dx);
    const angleDelta = Math.atan2(
      Math.sin(desiredAngle - car.angle),
      Math.cos(desiredAngle - car.angle)
    );
    const maxTurnPerFrame = Math.min(0.26, Math.max(0.08, 15 * delta));
    car.angle += Math.max(-maxTurnPerFrame, Math.min(maxTurnPerFrame, angleDelta));
    const alignment = Math.max(0.18, Math.cos(angleDelta));
    const steeringSpeedFactor = Math.min(1, alignment * 1.6);
    car.speed = Math.min(
      bypassSpeed * steeringSpeedFactor,
      distance / Math.max(delta * 60, 1)
    );
    car.isBraking = false;
    car.turnSignal = 'hazard';
    car.x += Math.cos(car.angle) * car.speed * 60 * delta;
    car.y += Math.sin(car.angle) * car.speed * 60 * delta;
    return true;
  }

  private getStopLineCoordinate(car: VehicleInstance, ai: NPCAIExtra, inter: Intersection) {
    const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const distanceFromCenter = inter.size / 2 + CROSSWALK_DEPTH + config.length / 2 + 8;

    if (ai.roadType === 'vertical') {
      if (ai.direction === 'south') return inter.y - distanceFromCenter;
      if (ai.direction === 'north') return inter.y + distanceFromCenter;
    } else {
      if (ai.direction === 'east') return inter.x - distanceFromCenter;
      if (ai.direction === 'west') return inter.x + distanceFromCenter;
    }

    return null;
  }

  private holdAtStopLine(car: VehicleInstance, ai: NPCAIExtra, inter: Intersection) {
    const stopLine = this.getStopLineCoordinate(car, ai, inter);
    if (stopLine === null) return;

    if (ai.roadType === 'vertical') {
      if (ai.direction === 'south' && car.y > stopLine) car.y = stopLine;
      if (ai.direction === 'north' && car.y < stopLine) car.y = stopLine;
    } else {
      if (ai.direction === 'east' && car.x > stopLine) car.x = stopLine;
      if (ai.direction === 'west' && car.x < stopLine) car.x = stopLine;
    }
  }

  private cleanupIntersectionReservations(delta: number) {
    for (const [intersectionId, ownerId] of this.intersectionReservations) {
      const age = (this.intersectionReservationAge.get(intersectionId) || 0) + delta;
      this.intersectionReservationAge.set(intersectionId, age);
      const inter = this.cityMap.intersections.find((candidate) => candidate.id === intersectionId);
      const owner = this.npcVehicles.find((car) => car.id === ownerId && car.health > 0);
      const ownerAi = owner ? this.aiData.get(owner.id) : undefined;
      // A healthy crossing is completed well before this timeout. If a
      // reservation survives longer, it is stale and must not deadlock every
      // approach behind it.
      if (age > 5 || !inter || !owner || !ownerAi) {
        this.intersectionReservations.delete(intersectionId);
        this.intersectionReservationAge.delete(intersectionId);
        continue;
      }

      if (ownerAi.isTurning && ownerAi.lastIntersectionId === intersectionId) {
        if (Math.hypot(owner.x - inter.x, owner.y - inter.y) > 150) {
          this.intersectionReservations.delete(intersectionId);
          this.intersectionReservationAge.delete(intersectionId);
        }
        continue;
      }

      const approachDistance = this.getIntersectionApproachDistance(owner, ownerAi, inter);
      if (approachDistance === null || approachDistance < -120 || approachDistance > 190) {
        this.intersectionReservations.delete(intersectionId);
        this.intersectionReservationAge.delete(intersectionId);
      }
    }
  }

  private shouldYieldAtIntersection(car: VehicleInstance, ai: NPCAIExtra, shouldStop: boolean) {
    if (ai.isTurning) return false;

    const active = this.getActiveIntersection(car, ai);
    if (!active) return false;

    let ownerId = this.intersectionReservations.get(active.inter.id);
    if (ownerId && ownerId !== car.id) {
      const owner = this.npcVehicles.find((candidate) => candidate.id === ownerId && candidate.health > 0);
      const ownerAi = owner ? this.aiData.get(owner.id) : undefined;
      const ownerApproachDistance = owner && ownerAi
        ? this.getIntersectionApproachDistance(owner, ownerAi, active.inter)
        : null;
      const ownerInJunction = Boolean(
        owner && ownerAi &&
          ((ownerAi.isTurning && ownerAi.lastIntersectionId === active.inter.id) ||
            (ownerApproachDistance !== null && ownerApproachDistance <= 145 && ownerApproachDistance > -120))
      );

      // A vehicle that has stopped before the conflict zone (for example at a
      // red light or behind a queue) does not own the crossing. Releasing this
      // stale reservation prevents a perpendicular lane from waiting forever.
      if (!ownerInJunction) {
        this.intersectionReservations.delete(active.inter.id);
        this.intersectionReservationAge.delete(active.inter.id);
        ownerId = undefined;
      } else if (ownerAi && !ownerAi.isTurning && ownerAi.roadType === ai.roadType) {
        // The traffic signal already separates north-south from east-west.
        // Serializing every car through one reservation throttles a green
        // platoon to one vehicle at a time and creates queues on empty roads.
        return false;
      } else if (active.approachDistance > 20) {
        return true;
      }
    } else if (!ownerId && !shouldStop && active.approachDistance <= 145) {
      // Claim only after traffic-light and same-lane braking checks pass. A
      // vehicle stopped at a red light therefore cannot block the junction.
      this.intersectionReservations.set(active.inter.id, car.id);
      this.intersectionReservationAge.set(active.inter.id, 0);
    }

    return false;
  }

  private areSameTrafficLane(first: NPCAIExtra, second: NPCAIExtra) {
    if (first.isTurning || second.isTurning || first.roadType !== second.roadType) return false;
    if (first.roadCoord !== second.roadCoord || first.direction !== second.direction) return false;

    const firstLane = this.getTargetLane(first.roadType, first.roadCoord, first.direction, first.laneIndex);
    const secondLane = this.getTargetLane(second.roadType, second.roadCoord, second.direction, second.laneIndex);
    return first.roadType === 'vertical'
      ? Math.abs(firstLane.x! - secondLane.x!) < 10
      : Math.abs(firstLane.y! - secondLane.y!) < 10;
  }

  private resolveNpcSpacing() {
    // Keep one broad phase and ordering for the full tick instead of rebuilding
    // both on every pass. A bounded number of passes is enough to resolve a
    // dense queue. Repeating a
    // full positional correction 16 times lets lane-centering undo it on the
    // next frame, which is the visible "dancing" oscillation near junctions.
    // Twelve bounded passes leave enough room for a dense queue to settle
    // after adaptive bypass movement without reopening the old 16-pass jitter.
    for (let pass = 0; pass < 12; pass += 1) {
      // Corrections can move a car across a hash-cell boundary. Rebuilding
      // here prevents the next pass from querying stale neighbours and
      // leaving a pair overlapped after the solver appears to converge.
      this.vehicleIndex.clear();
      this.vehicleIndex.insertAll(this.npcVehicles);
      for (let i = 0; i < this.npcVehicles.length; i += 1) {
        const first = this.npcVehicles[i];
        if (first.health <= 0 || first.isCrashed) continue;
        const firstConfig = VEHICLE_CONFIGS[first.type] || VEHICLE_CONFIGS.sedan;

        for (const second of this.vehicleIndex.queryRadius(first.x, first.y, 220)) {
          const j = this.vehicleOrder.get(second.id);
          if (j === undefined || j <= i) continue;
          if (second.health <= 0 || second.isCrashed) continue;
          const secondConfig = VEHICLE_CONFIGS[second.type] || VEHICLE_CONFIGS.sedan;
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const firstAi = this.aiData.get(first.id);
          const secondAi = this.aiData.get(second.id);
          const distance = Math.hypot(dx, dy);
          // Keep same-heading traffic ordered along its lane. Choosing the
          // yielding vehicle by id alone can move the lead car forward and
          // make the following car catch it again on the next frame.
          const angleDifference = Math.atan2(
            Math.sin(second.angle - first.angle),
            Math.cos(second.angle - first.angle)
          );
          const sameAssignedLane = Boolean(
            firstAi && secondAi &&
              !firstAi.isTurning && !secondAi.isTurning &&
              firstAi.roadType === secondAi.roadType &&
              firstAi.roadCoord === secondAi.roadCoord &&
              firstAi.direction === secondAi.direction &&
              firstAi.laneIndex === secondAi.laneIndex
          );
          // Two cars side by side on the same road - in neighbouring lanes,
          // or one shifted out to pass or swerve - do not touch, however
          // close their centres are. Circle-based separation (radii of up to
          // half a bus length) is wider than a lane, so it shoved a car
          // passing a stopped neighbour sideways into oncoming traffic, and
          // shoved an overtaking car back behind the obstacle it was passing.
          if (
            firstAi && secondAi && !firstAi.isTurning && !secondAi.isTurning &&
            firstAi.roadType === secondAi.roadType && firstAi.roadCoord === secondAi.roadCoord
          ) {
            const across = firstAi.roadType === 'vertical' ? second.x - first.x : second.y - first.y;
            if (Math.abs(across) >= (firstConfig.width + secondConfig.width) / 2 + 2) continue;
          }
          const sameHeading = sameAssignedLane;
          const sameRoadOppositeLane = Boolean(
            firstAi && secondAi &&
              !firstAi.isTurning && !secondAi.isTurning &&
              firstAi.roadType === secondAi.roadType &&
              firstAi.roadCoord === secondAi.roadCoord &&
              firstAi.laneIndex === secondAi.laneIndex &&
              firstAi.direction !== secondAi.direction
          );
          const sameRoadDirection = Boolean(
            firstAi && secondAi &&
              !firstAi.isTurning && !secondAi.isTurning &&
              firstAi.roadType === secondAi.roadType &&
              firstAi.roadCoord === secondAi.roadCoord &&
              firstAi.direction === secondAi.direction
          );
          const firstRadius = Math.hypot(firstConfig.length / 2, firstConfig.width / 2);
          const secondRadius = Math.hypot(secondConfig.length / 2, secondConfig.width / 2);
          const minDistance = sameHeading
            ? (firstConfig.length + secondConfig.length) / 2 + 8
            : sameRoadOppositeLane
            ? (firstConfig.width + secondConfig.width) / 2 + 6
            : sameRoadDirection
            ? firstRadius + secondRadius + 10
            : firstRadius + secondRadius + 2;
          if (distance >= minDistance) continue;

          // Keep a small numerical buffer because several neighbouring pairs
          // can be corrected during the same pass.
          const needsImmediateClearance = Boolean(
            sameRoadDirection || firstAi?.isTurning || secondAi?.isTurning
          );
          const separation = needsImmediateClearance
            ? minDistance - distance + 3
            : Math.min(32, minDistance - distance + 3);

          const forwardGap = dx * Math.cos(first.angle) + dy * Math.sin(first.angle);
          const yielding = sameHeading && Math.abs(forwardGap) > 0.5
            ? (forwardGap > 0 ? first : second)
            : (first.id > second.id ? first : second);

          if (sameHeading) {
            const headingX = Math.cos(yielding.angle);
            const headingY = Math.sin(yielding.angle);
            yielding.x -= headingX * separation;
            yielding.y -= headingY * separation;
          } else if (firstAi?.isTurning || secondAi?.isTurning || sameRoadDirection) {
            // A turning car can be moving almost perpendicular to the other
            // car, and cars in neighbouring lanes need lateral separation.
            // Backing along the heading would not increase either gap. Resolve
            // this transient conflict on the contact normal; lane control then
            // eases the car back instead of making it oscillate across lanes.
            if (sameRoadDirection) {
              const bypassing = firstAi?.laneShift?.kind === 'bypass' ? first : secondAi?.laneShift?.kind === 'bypass' ? second : null;
              const bypassingAi = bypassing ? this.aiData.get(bypassing.id) : undefined;
              if (bypassingAi?.laneShift?.kind === 'bypass' && !bypassingAi.laneShift.released) {
                // The pass corridor became occupied after it was chosen.
                // Abandon the pass and ease back into the queue.
                bypassingAi.laneShift.released = true;
                bypassingAi.laneShift.reversing = false;
                bypassingAi.progressTimer = 0;
                bypassing.turnSignal = 'none';
                bypassing.speed = 0;
                bypassing.isBraking = true;
              }
            }
            const normalX = distance > 0.001 ? dx / distance : Math.cos(yielding.angle);
            const normalY = distance > 0.001 ? dy / distance : Math.sin(yielding.angle);
            if (yielding === first) {
              yielding.x -= normalX * separation;
              yielding.y -= normalY * separation;
            } else {
              yielding.x += normalX * separation;
              yielding.y += normalY * separation;
            }
          } else {
            // At a crossing, move the yielding car backwards along its own
            // lane. Separating along the contact normal can push it sideways
            // onto a neighbouring lane and create a second collision.
            const yieldingHeadingX = Math.cos(yielding.angle);
            const yieldingHeadingY = Math.sin(yielding.angle);
            yielding.x -= yieldingHeadingX * separation;
            yielding.y -= yieldingHeadingY * separation;
          }

          // Same-lane contact is a queue and must stop the follower. A
          // perpendicular contact is different: changing its speed here can
          // freeze the reservation owner inside the junction. Separation plus
          // the reservation controller is enough for crossing traffic.
          if (sameHeading) {
            yielding.speed = 0;
            yielding.isBraking = true;
          }
        }
      }
    }
  }

  private spawnInitialTraffic() {
    const types = [
      'sedan',
      'hatchback',
      'kamaz_dump',
      'ambulance',
      'police',
      'heavy_4x4',
      'taxi',
      'sports',
      'bus',
      'kamaz_flatbed',
    ] as const;

    const colors = [
      '#0d9488',
      '#e11d48',
      '#0284c7',
      '#f97316',
      '#eab308',
      '#9333ea',
      '#ffffff',
      '#334155',
      '#10b981',
      '#475569',
    ];

    for (let i = 0; i < this.maxCars; i++) {
      const isVert = i % 2 === 0;
      const roadCoord = isVert ? this.gridX[i % this.gridX.length] : this.gridY[i % this.gridY.length];
      const forward = Math.floor(i / 2) % 2 === 0;
      const direction: TrafficDirection = isVert
        ? forward
          ? 'south'
          : 'north'
        : forward
        ? 'east'
        : 'west';

      const lane = this.getTargetLane(isVert ? 'vertical' : 'horizontal', roadCoord, direction);
      const crossRoadCoordinates = isVert ? this.gridY : this.gridX;
      let roadPos = 300 + ((i * 270) % (WORLD_SIZE - 600));
      // Never spawn a car inside a junction. Several deterministic spawn
      // slots used to land exactly at a crossing, which looked like an AI
      // accident before the first traffic-light decision was even made.
      for (let attempt = 0; attempt < crossRoadCoordinates.length; attempt += 1) {
        if (!crossRoadCoordinates.some((coordinate) => Math.abs(roadPos - coordinate) < 180)) break;
        roadPos = 300 + ((roadPos - 300 + 260) % (WORLD_SIZE - 600));
      }

      const x = isVert ? lane.x! : roadPos;
      const y = isVert ? roadPos : lane.y!;
      const angle = lane.angle;

      const type = types[i % types.length];
      let color = colors[i % colors.length];

      if (type === 'police') color = '#0f172a';
      else if (type === 'ambulance') color = '#ffffff';
      else if (type === 'kamaz_dump') color = '#f97316';
      else if (type === 'kamaz_flatbed') color = '#0284c7';
      else if (type === 'taxi') color = '#eab308';

      const carId = `npc_car_${i}`;
      const car: VehicleInstance = {
        id: carId,
        type,
        x,
        y,
        angle,
        // Start from a rolling speed; spawning at cruise speed caused a
        // visible launch before the traffic controller could react.
        speed: 1.5 + Math.random() * 2.5,
        steeringAngle: 0,
        angularVelocity: 0,
        color,
        health: 100,
        maxHealth: 100,
        headlights: 1,
        turnSignal: 'none',
        isBraking: false,
        isReversing: false,
        isHonking: false,
        isSiren: type === 'ambulance' || type === 'police',
        isPlayer: false,
        smokeTimer: 0,
      };

      this.npcVehicles.push(car);
      const routeSourcePoiId = this.cityMap.pois[i % this.cityMap.pois.length]?.id || 'poi_depot';
      const routeTargetPoiId = this.cityMap.pois[(i * 3 + 2) % this.cityMap.pois.length]?.id || 'poi_market';
      this.aiData.set(carId, {
        roadType: isVert ? 'vertical' : 'horizontal',
        roadCoord,
        direction,
        laneIndex: (i % 4 === 1 ? 1 : 0) as 0 | 1,
        routeRoadIds: this.cityMap.getRouteBetweenPois(routeSourcePoiId, routeTargetPoiId),
        routeIndex: 0,
        rerouteCooldown: 0,
        routeSourcePoiId,
        routeTargetPoiId,
        isTurning: false,
        turnProgress: 0,
        turnStartAngle: angle,
        turnTargetAngle: angle,
        targetRoadCoord: roadCoord,
        targetDirection: direction,
        stuckTimer: 0,
        offroadTimer: 0,
        progressTimer: 0,
        lastX: x,
        lastY: y,
        activity: 'driving',
        driveTimer: 0,
        nextParkingIn: 18 + (i % 6) * 7,
        parkingTimer: 0,
        abandonAfterParking: false,
      });
    }
  }

  private spawnInitialPedestrians() {
    const skinColors = ['#fbcfe8', '#fed7aa', '#fde047', '#e2e8f0', '#d6d3d1'];
    const shirtColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];
    const pantsColors = ['#1e293b', '#334155', '#475569', '#1e1b4b', '#0f172a'];

    for (let i = 0; i < this.maxPedestrians; i++) {
      const isVert = i % 2 === 0;
      const roadCoord = isVert ? this.gridX[i % this.gridX.length] : this.gridY[i % this.gridY.length];
      const side = (i % 4 < 2 ? 1 : -1) * this.sidewalkOffset;
      const spreadRange = WORLD_SIZE - 560;
      const axis = isVert ? 'vertical' : 'horizontal';
      const probe = { walkRoadCoord: roadCoord, walkSide: side, x: 0, y: 0 } as Pedestrian;
      // Non-grid roads cut across sidewalks, so a fixed spread can land on a
      // carriageway or in a pocket too short to walk in. Slide along the
      // sidewalk to the first spot that has both kerb clearance and room.
      let spread = 280 + (i * 240) % spreadRange;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const candidate = 280 + ((i * 240) + attempt * 97) % spreadRange;
        const cx = isVert ? roadCoord + side : candidate;
        const cy = isVert ? candidate : roadCoord + side;
        const room = this.getPedestrianAxisBounds(candidate, this.pedestrianCrossings(probe, axis));
        spread = candidate;
        if (room.upper - room.lower >= 60 && candidate >= room.lower && candidate <= room.upper
          && this.cityMap.clearanceToRoads({ x: cx, y: cy, width: 0, height: 0 }) >= 20) break;
      }

      const px = isVert ? roadCoord + side : spread;
      const py = isVert ? spread : roadCoord + side;

      this.pedestrians.push({
        id: `ped_${i}`,
        x: px,
        y: py,
        angle: Math.random() * Math.PI * 2,
        speed: 1.1 + Math.random() * 0.8,
        targetX: px,
        targetY: py,
        state: 'walking',
        health: 100,
        skinColor: skinColors[i % skinColors.length],
        shirtColor: shirtColors[i % shirtColors.length],
        pantsColor: pantsColors[i % pantsColors.length],
        speechTimer: 0,
        ragdollTimer: 0,
        vx: 0,
        vy: 0,
        walkRoadType: isVert ? 'vertical' : 'horizontal',
        walkRoadCoord: roadCoord,
        walkSide: side,
        walkDirection: i % 2 === 0 ? 1 : -1,
      });
      const pedestrian = this.pedestrians[this.pedestrians.length - 1];
      // Most residents have a destination instead of pacing the same block;
      // a small remainder keeps streets visibly populated between visits.
      if (i % 4 !== 0) this.assignBuildingTrip(pedestrian);
      else this.choosePedestrianWaypoint(pedestrian);
    }
  }

  public handleVehicleCrash(
    firstVehicle: VehicleInstance,
    secondVehicle: VehicleInstance | undefined,
    impactSpeed: number,
    x: number,
    y: number
  ) {
    const participants = [firstVehicle, secondVehicle].filter(
      (vehicle): vehicle is VehicleInstance => Boolean(vehicle && !vehicle.isPlayer)
    );
    if (participants.length === 0) return;

    const complaints = [
      'Вы вообще смотрите на дорогу?',
      'Спокойно, без паники. Вызываем помощь.',
      'Вот это поворот... Машину жалко.',
      'Нужно оформить аварию и освободить проезд.',
      'Крыло помяли. Давайте разберёмся спокойно.',
    ];
    const damage = Math.min(58, Math.max(12, Math.round((impactSpeed - 2) * 4.5)));

    participants.forEach((vehicle, index) => {
      if (vehicle.isCrashed) return;

      vehicle.isCrashed = true;
      vehicle.crashTimer = 12;
      vehicle.crashSpeech = complaints[index % complaints.length];
      vehicle.crashSpeechTimer = 4.5;
      vehicle.health = Math.max(8, vehicle.health - damage);
      vehicle.speed = 0;
      vehicle.steeringAngle = 0;
      vehicle.angularVelocity = 0;
      vehicle.turnSignal = 'hazard';
      vehicle.isBraking = true;

      const side = index === 0 ? -1 : 1;
      const exitOffset = (VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan).width * 0.9;
      const driverX = vehicle.x - Math.sin(vehicle.angle) * exitOffset * side;
      const driverY = vehicle.y + Math.cos(vehicle.angle) * exitOffset * side;
      const driverId = `driver_${vehicle.id}`;
      const existingDriver = this.pedestrians.find((ped) => ped.id === driverId);

      if (!existingDriver) {
        this.pedestrians.push({
          id: driverId,
          x: driverX,
          y: driverY,
          angle: Math.atan2(y - driverY, x - driverX),
          speed: 0,
          targetX: x + Math.cos(vehicle.angle) * 18,
          targetY: y + Math.sin(vehicle.angle) * 18,
          state: 'talking',
          health: 100,
          skinColor: index === 0 ? '#fed7aa' : '#fde047',
          shirtColor: index === 0 ? '#2563eb' : '#dc2626',
          pantsColor: '#1e293b',
          speechText: vehicle.crashSpeech,
          speechTimer: 4.5,
          ragdollTimer: 0,
          vx: 0,
          vy: 0,
          isDriver: true,
          vehicleId: vehicle.id,
          walkDirection: side > 0 ? 1 : -1,
        });
      }
    });
  }

  // Update NPC Traffic Simulation
  public updateTraffic(delta: number, playerVehicle?: VehicleInstance | null) {
    const sirenActive = Boolean(playerVehicle && playerVehicle.isSiren);
    this.cleanupIntersectionReservations(delta);
    this.vehicleIndex.clear();
    this.vehicleIndex.insertAll(this.npcVehicles);
    this.vehicleOrder.clear();
    this.npcVehicles.forEach((vehicle, index) => this.vehicleOrder.set(vehicle.id, index));
    this.pedestrianIndex.clear();
    this.pedestrianIndex.insertAll(this.pedestrians);

    for (const car of this.npcVehicles) {
      if (car.isCrashed) {
        car.speed = 0;
        car.isBraking = true;
        car.turnSignal = 'hazard';
        car.crashTimer = Math.max(0, (car.crashTimer || 0) - delta);
        car.crashSpeechTimer = Math.max(0, (car.crashSpeechTimer || 0) - delta);

        if ((car.crashTimer || 0) <= 0) {
          car.isCrashed = false;
          car.crashTimer = undefined;
          car.crashSpeech = undefined;
          car.crashSpeechTimer = undefined;
          car.turnSignal = 'none';
          car.isBraking = false;
        }
        continue;
      }
      if (car.health <= 0) continue; // Wrecked vehicle

      let ai = this.aiData.get(car.id);
      if (!ai) {
        ai = {
          roadType: 'vertical',
          roadCoord: this.gridX[0],
          direction: 'south',
          laneIndex: 0,
          routeRoadIds: [],
          routeIndex: 0,
          rerouteCooldown: 0,
          isTurning: false,
          turnProgress: 0,
          turnStartAngle: Math.PI / 2,
          turnTargetAngle: Math.PI / 2,
          targetRoadCoord: this.gridX[0],
          targetDirection: 'south',
          stuckTimer: 0,
          offroadTimer: 0,
          progressTimer: 0,
          lastX: car.x,
          lastY: car.y,
          activity: 'driving',
          driveTimer: 0,
          nextParkingIn: 30,
          parkingTimer: 0,
          abandonAfterParking: false,
        };
        this.aiData.set(car.id, ai);
      }

      const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
      if (ai.activity === 'parked') {
        ai.parkingTimer = Math.max(0, ai.parkingTimer - delta);
        car.speed = 0;
        car.isBraking = true;
        car.npcParked = true;
        continue;
      }
      ai.driveTimer += delta;
      if (ai.driveTimer >= ai.nextParkingIn && !ai.isTurning && !ai.laneShift && !ai.groundBypass) {
        this.planParkingStop(car, ai);
      }
      let parkingDistance: number | undefined;
      if (ai.parkingCoordinate !== undefined && !ai.isTurning) {
        const current = ai.roadType === 'vertical' ? car.y : car.x;
        parkingDistance = ai.direction === 'south' || ai.direction === 'east'
          ? ai.parkingCoordinate - current
          : current - ai.parkingCoordinate;
        const bayOffset = this.getParkingBayOffset(car, ai);
        // Signal and start pulling over early enough for the sideways
        // move, which only happens while rolling forward.
        const pullOverRoom = Math.abs(bayOffset) / MAX_LANE_SHIFT_SLOPE + 30;
        if (parkingDistance > 0 && parkingDistance < pullOverRoom + 60 && this.isParkingBayOccupied(car, ai, bayOffset)) {
          // Someone got there first: drive on rather than pull into them.
          ai.parkingCoordinate = undefined;
          if (ai.laneShift?.kind === 'park') ai.laneShift.released = true;
        } else if (!ai.laneShift && parkingDistance > 0 && parkingDistance < pullOverRoom) {
          ai.laneShift = { kind: 'park', targetId: '', offset: bayOffset, released: false };
          car.turnSignal = this.getShiftSignal(ai, bayOffset);
        }
        if (ai.laneShift?.kind === 'park' && !ai.laneShift.released) {
          const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
          const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
          const across = ai.roadType === 'vertical' ? car.x : car.y;
          if (Math.abs(across - (laneCoord + ai.laneShift.offset)) < 1.5 && Math.abs(car.speed) < 0.4) {
            this.beginParking(car, ai);
            continue;
          }
        }
        if (parkingDistance < -60) {
          // Overshot the bay (held up by traffic): give up on this stop.
          ai.parkingCoordinate = undefined;
          if (ai.laneShift?.kind === 'park') ai.laneShift.released = true;
          parkingDistance = undefined;
        }
      }
      const cruiseSpeed = this.getNpcCruiseSpeed(car, ai);
      if (this.updateGroundBypass(car, ai, delta, cruiseSpeed)) {
        ai.lastX = car.x;
        ai.lastY = car.y;
        continue;
      }
      const movementSinceLastTick = Math.hypot(car.x - ai.lastX, car.y - ai.lastY);
      ai.progressTimer = movementSinceLastTick < 0.2 ? ai.progressTimer + delta : 0;
      ai.rerouteCooldown = Math.max(0, ai.rerouteCooldown - delta);
      ai.lastX = car.x;
      ai.lastY = car.y;
      // Hysteresis: a blocked route may be reconsidered, but not every frame.
      // This is the traffic equivalent of a driver waiting for the next safe
      // gap instead of oscillating between two turns.
      if (
        ai.progressTimer > 1.4 &&
        ai.rerouteCooldown <= 0 &&
        ai.routeSourcePoiId &&
        ai.routeTargetPoiId
      ) {
        const blockedRoadIds = this.npcVehicles
          .filter((candidate) => candidate.id !== car.id && candidate.isCrashed)
          .map((candidate) => ai.routeRoadIds[Math.min(ai.routeIndex, Math.max(0, ai.routeRoadIds.length - 1))])
          .filter((roadId): roadId is string => Boolean(roadId));
        const alternative = this.cityMap.getRouteBetweenPois(
          ai.routeSourcePoiId,
          ai.routeTargetPoiId,
          blockedRoadIds,
          (edge) => {
            const road = this.cityMap.roads.find((candidate) => candidate.id === edge.roadId);
            if (!road) return 0;
            const occupancy = this.npcVehicles.filter((candidate) => {
              if (candidate.id === car.id || candidate.health <= 0) return false;
              return road.points.some((point) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 130);
            }).length;
            const crashed = this.npcVehicles.some((candidate) =>
              candidate.id !== car.id && candidate.isCrashed && road.points.some((point) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 150)
            );
            return occupancy * 24 + (crashed ? 12000 : 0);
          }
        );
        if (alternative.length > 0) {
          ai.routeRoadIds = alternative;
          ai.routeIndex = 0;
          ai.rerouteCooldown = 2.2;
        }
      }
      // Traffic uses the same world-unit scale as the player physics. Keeping
      // NPCs below 16 px/frame leaves enough distance to react to a light and
      // prevents the first frame burst from turning into a traffic pile-up.
      let targetSpeed = cruiseSpeed;
      let shouldStop = false;
      // Full brake-pedal stop for an imminent collision, rather than the
      // service braking the speed target produces.
      let emergencyBrake = false;
      let waitingForTrafficLight = false;
      let stopLineIntersection: Intersection | null = null;

      // 1. Off-Road Recovery: Check if shoved far off the road grid
      let nearestRoadDist = 9999;
      let nearestIsVert = true;
      let nearestCoord = this.gridX[0];

      for (const gx of this.gridX) {
        const d = Math.abs(car.x - gx);
        if (d < nearestRoadDist) {
          nearestRoadDist = d;
          nearestIsVert = true;
          nearestCoord = gx;
        }
      }
      for (const gy of this.gridY) {
        const d = Math.abs(car.y - gy);
        if (d < nearestRoadDist) {
          nearestRoadDist = d;
          nearestIsVert = false;
          nearestCoord = gy;
        }
      }

      if (nearestRoadDist > 110 && !ai.groundBypass) {
        ai.offroadTimer += delta;
        if (ai.offroadTimer > 2.0) {
          // Clean respawn back onto nearest road lane
          ai.offroadTimer = 0;
          ai.isTurning = false;
          ai.roadType = nearestIsVert ? 'vertical' : 'horizontal';
          ai.roadCoord = nearestCoord;
          ai.direction = nearestIsVert ? 'south' : 'east';
          const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
          if (nearestIsVert) {
            car.x = lane.x!;
          } else {
            car.y = lane.y!;
          }
          car.angle = lane.angle;
          car.speed = cruiseSpeed;
        }
      } else {
        ai.offroadTimer = 0;
      }

      // 2. Emergency Siren Yielding
      if (sirenActive && playerVehicle && !car.isSiren) {
        const distToEmergency = Math.hypot(playerVehicle.x - car.x, playerVehicle.y - car.y);
        if (distToEmergency < 260) {
          targetSpeed *= 0.35;
        }
      }

      // 3. Traffic Light Stop Detection (Before intersection)
      // The old 40-95px window was shorter than a full braking distance at
      // cruise speed. NPCs could therefore leave the detection window while
      // still moving and enter a red intersection.
      if (!car.isSiren && !ai.isTurning) {
        for (const inter of this.cityMap.intersections) {
          if (inter.trafficControlled === false) continue;
          // Once the car has entered this junction, it must clear it even if
          // the new direction is red after a turn. Reapplying that signal
          // clamps a turning car back to the old stop line across the lanes.
          if (ai.lastIntersectionId === inter.id) continue;
          let distAxis = 9999;
          let lightState: 'red' | 'yellow' | 'green' = 'green';

          // Two lanes per direction place the inner lane farther from the
          // road center. Check the road corridor, not only the old single
          // lane center, otherwise the second lane would ignore the light.
          if (ai.roadType === 'vertical' && Math.abs(car.x - inter.x) < 110) {
            if (ai.direction === 'south') {
              distAxis = inter.y - car.y; // Approaching from North (above)
              if (distAxis > 0 && distAxis < 230) {
                const tl = this.cityMap.trafficLights.find(
                  (t) => t.intersectionId === inter.id && t.direction === 'north'
                );
                if (tl) lightState = tl.state;
              }
            } else if (ai.direction === 'north') {
              distAxis = car.y - inter.y; // Approaching from South (below)
              if (distAxis > 0 && distAxis < 230) {
                const tl = this.cityMap.trafficLights.find(
                  (t) => t.intersectionId === inter.id && t.direction === 'south'
                );
                if (tl) lightState = tl.state;
              }
            }
          } else if (ai.roadType === 'horizontal' && Math.abs(car.y - inter.y) < 110) {
            if (ai.direction === 'east') {
              distAxis = inter.x - car.x; // Approaching from West (left)
              if (distAxis > 0 && distAxis < 230) {
                const tl = this.cityMap.trafficLights.find(
                  (t) => t.intersectionId === inter.id && t.direction === 'west'
                );
                if (tl) lightState = tl.state;
              }
            } else if (ai.direction === 'west') {
              distAxis = car.x - inter.x; // Approaching from East (right)
              if (distAxis > 0 && distAxis < 230) {
                const tl = this.cityMap.trafficLights.find(
                  (t) => t.intersectionId === inter.id && t.direction === 'east'
                );
                if (tl) lightState = tl.state;
              }
            }
          }

          if (lightState === 'red' || lightState === 'yellow') {
            shouldStop = true;
            waitingForTrafficLight = true;
            stopLineIntersection = inter;
            break;
          }
        }
      }

      // Waiting out a red light is not a lack of progress. Counting it let a
      // long red trip the stuck-recovery on the first green frame, which
      // snapped the car into its lane and kicked it from 0 to cruise speed.
      if (waitingForTrafficLight) ai.progressTimer = 0;

      // 4. Intersection Conflict Avoidance
      // Traffic lights control normal flow, but cars can still arrive during
      // phase changes or while another vehicle is completing a turn. Reserve
      // the crossing with a deterministic priority so perpendicular NPCs do
      // not enter the same junction at the same time.
      if (this.shouldYieldAtIntersection(car, ai, shouldStop)) {
        shouldStop = true;
        const activeIntersection = this.getActiveIntersection(car, ai);
        stopLineIntersection = activeIntersection?.inter || stopLineIntersection;
      }

      // 5. Obstacle / Vehicle Distance Safe Braking
      let blockedByTraffic = false;
      let blockedByPlayer = false;
      let blockedObstacle: VehicleInstance | null = null;
      const activeIntersection = this.getActiveIntersection(car, ai);
      if (!ai.isTurning) {
        // Look as far ahead as this car needs to stop: a fixed short range
        // left a car at cruise speed short of braking room behind a queue.
        const scanRange = Math.max(220, (60 * Math.max(0, car.speed) ** 2) / (2 * getPlanningBraking(config)) + 80);
        const allObstacles = this.vehicleIndex.queryRadius(car.x, car.y, scanRange);
        if (playerVehicle && Math.hypot(playerVehicle.x - car.x, playerVehicle.y - car.y) <= scanRange) {
          allObstacles.push(playerVehicle);
        }
        // The scan reacts to the first leader it finds, so it must be the
        // nearest one; the spatial hash returns neighbours in cell order.
        allObstacles.sort((first, second) =>
          Math.hypot(first.x - car.x, first.y - car.y) - Math.hypot(second.x - car.x, second.y - car.y)
        );
        for (const other of allObstacles) {
          if (other.id === car.id) continue;
          if (!other.isPlayer && (other.health <= 0 || other.isCrashed)) continue;
          // Mid lane shift, only bodies that actually overlap across the
          // lane are in the way; the vehicle being passed is handled by
          // controlBypass.
          if (ai.laneShift && (other.id === ai.laneShift.targetId || !this.overlapsAcross(car, ai, other))) continue;

          // Perpendicular cars are governed by the intersection reservation
          // system. Treating them as a same-lane obstacle here made a car at
          // the stop line brake for a vehicle crossing in front of it, which
          // could freeze both approaches for an entire light cycle.
          const otherAi = other.isPlayer ? undefined : this.aiData.get(other.id);
          const sameTrafficLane = Boolean(
            otherAi && this.areSameTrafficLane(ai, otherAi)
          ) || Boolean(
            other.isPlayer && Math.cos(other.angle - car.angle) > 0.35
          );
          if (!sameTrafficLane) {
            // An oncoming car waiting in its own lane on this same road -
            // going straight, not turning - crosses nobody's path. Treating
            // it as a junction conflict let an oncoming queue lock this
            // approach (and, at road ends, deadlock both directions).
            const oncomingSameRoad = Boolean(
              otherAi && !otherAi.isTurning && !ai.isTurning &&
                otherAi.roadType === ai.roadType &&
                otherAi.roadCoord === ai.roadCoord &&
                otherAi.direction !== ai.direction
            );
            const otherInConflictZone = Boolean(
              !oncomingSameRoad &&
              activeIntersection &&
              otherAi &&
              activeIntersection.approachDistance > -20 &&
              Math.hypot(other.x - activeIntersection.inter.x, other.y - activeIntersection.inter.y) < 105 &&
              Math.hypot(other.x - car.x, other.y - car.y) < 145 &&
              Math.abs(other.speed) < 1.0
            );
            if (otherInConflictZone) {
              blockedByTraffic = true;
              shouldStop = true;
              stopLineIntersection = activeIntersection!.inter;
            }
            continue;
          }

            const dx = other.x - car.x;
            const dy = other.y - car.y;
            const dist = Math.hypot(dx, dy);

          if (dist < scanRange && dist > 1) {
            const forwardX = Math.cos(car.angle);
            const forwardY = Math.sin(car.angle);
            const dot = (dx * forwardX + dy * forwardY) / dist;
            const targetLane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
            const playerInSameLane = !other.isPlayer || (
              ai.roadType === 'vertical'
                ? Math.abs(other.x - targetLane.x!) < 58
                : Math.abs(other.y - targetLane.y!) < 58
            );

            if (dot > 0.82 && playerInSameLane) {
              const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
              // Bumper-to-bumper queue gap. The NPC value used to be shorter
              // than a car (bodies overlapping), so this snap and the spacing
              // pass (which wants half-lengths + 8) fought every frame.
              // Plus a margin that grows with speed: drivers keep more room
              // the faster they go, so a leader braking hard does not leave
              // the follower nowhere to stop.
              const safeFollowingDistance = other.isPlayer
                ? (config.length + otherConfig.length) * 0.5 + 24
                : (config.length + otherConfig.length) * 0.5 + 12 + Math.max(0, car.speed) * 4;
              // A player closing in hard enough to count as a hit (physics.ts
              // uses the same 5.5 threshold to trigger crash damage) should
              // land one - not get dodged by the AI teleporting itself to a
              // clean gap every step, which made the player unable to ever
              // actually hit a car ahead of it.
              const isPlayerRam = other.isPlayer && TrafficAI.isClosingFast(other, car);
              if (dist < safeFollowingDistance && !isPlayerRam) {
                if (other.isPlayer) blockedByPlayer = true;
                blockedObstacle = other;
                if (other.isPlayer) {
                  targetSpeed = Math.min(targetSpeed, Math.max(0, other.speed * 0.92));
                } else {
                  // Inside the queue gap: stop hard. No position override -
                  // teleporting the follower to the gap could jump it a car
                  // length or more, and any residual overlap is the spacing
                  // pass's job.
                  shouldStop = true;
                  if (car.speed > 0.5) emergencyBrake = true;
                }
                if (
                  activeIntersection &&
                  activeIntersection.approachDistance > -20 &&
                  Math.hypot(other.x - activeIntersection.inter.x, other.y - activeIntersection.inter.y) < 105 &&
                  Math.abs(other.speed) < 1.0
                ) {
                  blockedByTraffic = true;
                }
                if (dist < 26 && !car.isHonking && Math.random() < 0.04) {
                  car.isHonking = true;
                  setTimeout(() => {
                    car.isHonking = false;
                  }, 500);
                }
              } else if (!isPlayerRam) {
                // Follow on a stopping curve: match the leader's speed when
                // close, and only as fast as can still stop at the queue gap.
                const leaderSpeed = Math.max(0, other.speed || 0);
                const room = dist - safeFollowingDistance - Math.max(0, car.speed);
                // Match the leader exactly: a fraction of its speed compounds
                // down a platoon and slowed every queue behind the first car.
                targetSpeed = Math.min(targetSpeed, leaderSpeed + getStoppingCurveSpeed(config, room));
                const closingSpeed = Math.max(0, car.speed - leaderSpeed);
                if (closingSpeed > 0.5 && room < (60 * closingSpeed ** 2) / (2 * config.braking * 0.72)) emergencyBrake = true;
              }
              break;
            }
          }
        }
      }

      // The player can stop inside the conflict zone and is not required to
      // follow NPC lane rules. After a short wait, use a safe low-speed ground
      // detour instead of making the whole approach queue forever.
      const playerBlocksActiveIntersection = Boolean(
        !ai.isTurning &&
        activeIntersection &&
        playerVehicle &&
        !playerVehicle.isCrashed &&
        Math.abs(playerVehicle.speed) < 0.8 &&
        activeIntersection.approachDistance > -20 &&
        Math.hypot(playerVehicle.x - activeIntersection.inter.x, playerVehicle.y - activeIntersection.inter.y) < 120
      );
      if (playerBlocksActiveIntersection) {
        blockedByPlayer = true;
        shouldStop = true;
        stopLineIntersection = activeIntersection!.inter;
      }

      // Dedicated player following controller. It works independently of the
      // short-radius obstacle scan, so a stopped player is caught early enough
      // for the NPC to settle behind the bumper rather than tap it first.
      if (ai.laneShift?.kind === 'evade' && !ai.laneShift.released && (!playerVehicle || playerVehicle.id !== ai.laneShift.targetId)) {
        ai.laneShift.released = true;
      }
      if (playerVehicle && !ai.isTurning) {
        const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
        const playerDx = playerVehicle.x - car.x;
        const playerDy = playerVehicle.y - car.y;
        // Judge the player in the lane's frame, not the body's: mid-swerve
        // the body is yawed, which would swing a head-on threat out of the
        // "same lane" window and cancel the braking.
        const forwardX = Math.cos(lane.angle);
        const forwardY = Math.sin(lane.angle);
        const aheadDistance = playerDx * forwardX + playerDy * forwardY;
        const lateralDistance = Math.abs(playerDx * -forwardY + playerDy * forwardX);
        const sameLane = ai.roadType === 'vertical'
          ? Math.abs(playerVehicle.x - lane.x!) < 58
          : Math.abs(playerVehicle.y - lane.y!) < 58;
        const headingOpposition = Math.cos(playerVehicle.angle - lane.angle);
        const isHeadOnThreat = sameLane && aheadDistance > 0 && aheadDistance < 240 && lateralDistance < 58 && headingOpposition < -0.65;

        if (isHeadOnThreat) {
          // Emergency response: full braking plus, room permitting, one
          // committed swerve toward the kerb. Contact, if it still happens,
          // is left to physics.
          targetSpeed = 0;
          shouldStop = true;
          emergencyBrake = true;
          blockedByPlayer = true;
          if (!ai.laneShift) this.beginEvasion(car, ai, playerVehicle);
        }
        if (ai.laneShift?.kind === 'evade' && !ai.laneShift.released && ai.laneShift.targetId === playerVehicle.id) {
          // Hold the swerve until the threat has passed alongside or turned
          // away, then ease back into the lane.
          const threatPassed = aheadDistance < -(config.length + (VEHICLE_CONFIGS[playerVehicle.type] || VEHICLE_CONFIGS.sedan).length) * 0.5;
          if (threatPassed || (!isHeadOnThreat && aheadDistance > 260) || headingOpposition > -0.3) {
            ai.laneShift.released = true;
          }
        }

        const playerConfig = VEHICLE_CONFIGS[playerVehicle.type] || VEHICLE_CONFIGS.sedan;
        const safeGap = (config.length + playerConfig.length) * 0.5 + 24;
        const stoppingDistance = (60 * Math.max(0, car.speed) ** 2) / (2 * getPlanningBraking(config));
        const followRange = Math.max(210, safeGap + stoppingDistance + 40);
        const playerClosingFast = TrafficAI.isClosingFast(playerVehicle, car);
        // Passing or swerving past the player: following rules do not apply
        // once the bodies no longer overlap across the lane.
        const followPlayer = !(ai.laneShift && (
          (ai.laneShift.kind === 'bypass' && ai.laneShift.targetId === playerVehicle.id && !ai.laneShift.released) ||
          !this.overlapsAcross(car, ai, playerVehicle)
        ));

        if (followPlayer && !isHeadOnThreat && !playerClosingFast && sameLane && aheadDistance > 0 && aheadDistance < followRange && lateralDistance < 58) {
          // Brake along a stopping curve: the fastest speed from which
          // service braking can still settle at safeGap behind the player.
          // Seeing the player only at the old fixed 210 range left a car at
          // cruise speed several hundred units short of the room it needs
          // to stop, so it ploughed into a stopped player. This is a speed
          // target only, so following a moving player stays smooth.
          const room = aheadDistance - safeGap - Math.max(0, car.speed);
          targetSpeed = Math.min(targetSpeed, Math.max(0, playerVehicle.speed * 0.92) + getStoppingCurveSpeed(config, room));
          // Closing on a slower player too fast for service braking to stop
          // in the room left: stand on the brake, as a driver would.
          const closingSpeed = Math.max(0, car.speed - Math.max(0, playerVehicle.speed));
          const serviceStoppingDistance = (60 * closingSpeed ** 2) / (2 * config.braking * 0.72);
          if (closingSpeed > 0.5 && room < serviceStoppingDistance) emergencyBrake = true;
        }

        if (sameLane && aheadDistance < 0 && aheadDistance > -200 && lateralDistance < 58 && playerClosingFast) {
          // Rammed from behind: a real driver cannot dodge sideways in time.
          // Lean on the horn and keep driving rather than braking into it.
          TrafficAI.honk(car, 700);
        }

        if (followPlayer && !isHeadOnThreat && sameLane && aheadDistance > 0 && aheadDistance < 210 && lateralDistance < 58) {
          if (playerClosingFast) {
            // The player is backing into the NPC. There is nowhere sensible
            // to swerve to from a standstill-speed queue: sound the horn,
            // stop, and leave any contact to physics.
            targetSpeed = 0;
            shouldStop = true;
            blockedByPlayer = true;
            TrafficAI.honk(car, 700);
          } else {
            blockedByPlayer = true;
            blockedObstacle = playerVehicle;
            // One frame's worth of coasting at the car's current speed can
            // cross straight through a gap that still looked safe when this
            // frame started (world units move ~car.speed per frame).
            const projectedAheadDistance = aheadDistance - Math.max(0, car.speed);
            if (projectedAheadDistance <= safeGap && Math.abs(playerVehicle.speed) < 0.5) {
              // Last resort for a stationary player only, e.g. a car that
              // spawned or turned in too close to stop on the curve above.
              // A moving player is never snapped to, so the NPC cannot read
              // as glued to their bumper.
              shouldStop = true;
              car.x = playerVehicle.x - forwardX * safeGap;
              car.y = playerVehicle.y - forwardY * safeGap;
              car.speed = 0;
            }
          }
        }
      }
      if (blockedObstacle && !activeIntersection && ai.progressTimer > 0.45) {
        this.startBypass(car, ai, blockedObstacle, playerVehicle);
      }
      if (blockedByPlayer && activeIntersection && ai.progressTimer > 2.5) {
        if (this.startGroundBypass(car, ai, activeIntersection.inter)) continue;
      }
      if (blockedByTraffic && activeIntersection && ai.progressTimer > 3.5) {
        if (this.startGroundBypass(car, ai, activeIntersection.inter)) continue;
      }

      // Braking alone is not enough when a car reaches a stop line at the
      // end of a frame. Clamp its centre behind the line so a queue never
      // waits on a crosswalk or in the conflict zone.
      if (shouldStop && stopLineIntersection && !ai.isTurning) {
        this.holdAtStopLine(car, ai, stopLineIntersection);
        car.speed = 0;
      }

      // 6. Pedestrian Safety Braking
      for (const ped of this.pedestrianIndex.queryRadius(car.x, car.y, 55)) {
        if (ped.state === 'ragdoll') continue;
        const pdx = ped.x - car.x;
        const pdy = ped.y - car.y;
        const pDist = Math.hypot(pdx, pdy);

        if (pDist < 50) {
          const forwardX = Math.cos(car.angle);
          const forwardY = Math.sin(car.angle);
          const dot = (pdx * forwardX + pdy * forwardY) / pDist;

          if (dot > 0.8) {
            shouldStop = true;
            break;
          }
        }
      }

      // Recover from a genuine deadlock without breaking a normal red-light
      // queue. A traffic phase is shorter than this timeout, so a car that has
      // waited through a full phase is safe to re-seed behind the stop line.
      // Every other reader of cityMap.intersections filters out uncontrolled
      // landmarks (roundabouts, T-junctions) since NPCs never queue at them;
      // this one didn't, so a map with more landmark markers than signalled
      // crossings made most of the road network "near an intersection" and
      // gave cars a 12s stuck tolerance almost everywhere instead of 2.5s.
      const nearIntersection = this.cityMap.intersections.some(
        (inter) => inter.trafficControlled !== false && Math.hypot(inter.x - car.x, inter.y - car.y) < 150
      );
      if (ai.progressTimer > 0.75 && !ai.isTurning) {
        ai.stuckTimer += delta;
        const stuckLimit = nearIntersection ? 12 : 2.5;
        if (
          ai.progressTimer > stuckLimit &&
          (!waitingForTrafficLight || ai.progressTimer > 18)
        ) {
          ai.stuckTimer = 0;
          if (ai.laneShift) {
            // Never snap a car that is beside an obstacle back into its
            // lane; drop the manoeuvre and let it ease back on its own.
            ai.laneShift.released = true;
            ai.laneShift.reversing = false;
            ai.progressTimer = 0;
            continue;
          }
          const activeIntersection = this.getActiveIntersection(car, ai);
          if (activeIntersection) {
            const ownerId = this.intersectionReservations.get(activeIntersection.inter.id);
            if (ownerId && ownerId !== car.id) {
              const owner = this.npcVehicles.find((candidate) => candidate.id === ownerId && candidate.health > 0);
              const ownerAi = owner ? this.aiData.get(owner.id) : undefined;
              const ownerInJunction = Boolean(
                owner && ownerAi &&
                  ((ownerAi.isTurning && ownerAi.lastIntersectionId === activeIntersection.inter.id) ||
                    Math.hypot(owner.x - activeIntersection.inter.x, owner.y - activeIntersection.inter.y) < 60)
              );

              const ownerBlocked = Boolean(owner && Math.abs(owner.speed) <= 0.6);
              if (ownerInJunction && !ownerBlocked && ai.progressTimer < stuckLimit) {
                ai.stuckTimer = 11.5;
                continue;
              }
              // If the reservation owner itself is stopped in the conflict
              // zone, release it so one vehicle can escape instead of making
              // both approaches wait forever.
              this.intersectionReservations.delete(activeIntersection.inter.id);
              this.intersectionReservationAge.delete(activeIntersection.inter.id);
            }
          }

          const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
          if (ai.roadType === 'vertical') car.x = lane.x!;
          else car.y = lane.y!;
          // Recovery may realign the car to its lane, but must not teleport it
          // backward; that rollback looked like a sudden position snap.
          car.angle = lane.angle;
          // Speed is left to the integrator: setting it outright launched a
          // stationary car straight to cruise speed in one frame.
          ai.progressTimer = 0;
          ai.stuckTimer = 0;
          ai.lastX = car.x;
          ai.lastY = car.y;
        }
      } else {
        ai.stuckTimer = 0;
      }

      // 7. Intersection Turning Navigation & Lane Handover
      if (!ai.isTurning && !shouldStop) {
        for (const inter of this.cityMap.intersections) {
          if (inter.trafficControlled === false) continue;
          const dInter = Math.hypot(inter.x - car.x, inter.y - car.y);

          // Check if right at intersection entrance
          if (dInter < 116 && ai.lastIntersectionId !== inter.id) {
            ai.lastIntersectionId = inter.id;

            const routeTurn = this.getRouteTurn(ai, inter);
            const roll = routeTurn === null ? Math.random() : routeTurn ? 0.1 : 0.5;
            if (roll < 0.32) {
              // Decide Turn: Left or Right
              const isRightTurn = roll < 0.16;
              const occupiedByTurningNpc = this.npcVehicles.some((other) => {
                if (other.id === car.id || other.health <= 0 || other.isCrashed) return false;
                const otherAi = this.aiData.get(other.id);
                return Boolean(
                  otherAi?.isTurning &&
                    otherAi.lastIntersectionId === inter.id &&
                    Math.hypot(other.x - inter.x, other.y - inter.y) < 180
                );
              });
              const reservedByAnotherNpc = this.intersectionReservations.get(inter.id);
              if (occupiedByTurningNpc || (reservedByAnotherNpc && reservedByAnotherNpc !== car.id)) {
                // Never start a second Bezier turn in the same conflict zone.
                // Positional spacing cannot stabilize two perpendicular paths;
                // yielding before the arc prevents the visible orbit/dance.
                shouldStop = true;
                targetSpeed = 0;
                ai.lastIntersectionId = undefined;
                break;
              }
              const turnResult = this.calculateIntersectionTurn(
                inter,
                ai.roadType,
                ai.direction,
                isRightTurn,
                ai.laneIndex
              );

              if (turnResult) {
                ai.isTurning = true;
                ai.turnProgress = 0;
                ai.turnStartPos = { x: car.x, y: car.y };
                ai.turnEndPos = turnResult.endPos;
                ai.turnControlPos = turnResult.controlPos;
                ai.turnStartAngle = car.angle;
                ai.turnTargetAngle = turnResult.targetAngle;
                ai.targetRoadCoord = turnResult.targetRoadCoord;
                ai.targetDirection = turnResult.targetDirection;
                car.turnSignal = isRightTurn ? 'right' : 'left';
                this.intersectionReservations.set(inter.id, car.id);
                this.intersectionReservationAge.set(inter.id, 0);
                // Commit to the turn before the car reaches the Bezier arc,
                // giving the normal brake integrator time to shed speed.
                targetSpeed = Math.min(targetSpeed, 8);
              }
            } else {
              // Straight
              car.turnSignal = 'none';
            }
            break;
          }
        }
      }

      // A turn takes over steering; an unfinished swerve does not carry into it.
      if (ai.isTurning) ai.laneShift = undefined;

      // 8. Execute Smooth Bezier Intersection Turn
      if (ai.isTurning && ai.turnStartPos && ai.turnEndPos && ai.turnControlPos) {
        // ~23 km/h on the tight city turn; the same cap governs every model
        // so buses and sport coupes do not slide around corners alike.
        targetSpeed = Math.min(targetSpeed, 6.5);
        ai.turnProgress += Math.max(0.012, (car.speed * 0.12) * delta);

        if (ai.turnProgress >= 1.0) {
          // Completed turn: transfer directly to destination lane
          ai.isTurning = false;
          car.x = ai.turnEndPos.x;
          car.y = ai.turnEndPos.y;
          car.angle = ai.turnTargetAngle;
          car.turnSignal = 'none';

          if (ai.isUTurn) {
            ai.isUTurn = false;
            ai.direction = ai.targetDirection;
          } else {
            ai.roadType = ai.roadType === 'vertical' ? 'horizontal' : 'vertical';
            ai.roadCoord = ai.targetRoadCoord;
            ai.direction = ai.targetDirection;
            // A parking stop planned on the previous road means nothing here.
            ai.parkingCoordinate = undefined;
            ai.routeIndex = Math.min(ai.routeRoadIds.length, ai.routeIndex + 1);
            if (ai.routeIndex >= ai.routeRoadIds.length - 1 && ai.routeTargetPoiId) {
              const nextPoi = this.cityMap.pois[(Number(car.id.replace(/\D/g, '')) + ai.routeIndex + 3) % this.cityMap.pois.length];
              if (nextPoi) {
                ai.routeSourcePoiId = ai.routeTargetPoiId;
                ai.routeTargetPoiId = nextPoi.id;
                ai.routeRoadIds = this.cityMap.getRouteBetweenPois(ai.routeSourcePoiId, ai.routeTargetPoiId);
                ai.routeIndex = 0;
              }
            }
          }
        } else {
          // Quadratic Bezier Position Interpolation
          const t = ai.turnProgress;
          const u = 1 - t;
          const p0 = ai.turnStartPos;
          const p1 = ai.turnControlPos;
          const p2 = ai.turnEndPos;

          car.x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
          car.y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;

          // Angular interpolation with wrap-around safety
          const diff = Math.atan2(
            Math.sin(ai.turnTargetAngle - ai.turnStartAngle),
            Math.cos(ai.turnTargetAngle - ai.turnStartAngle)
          );
          car.angle = ai.turnStartAngle + diff * t;
        }
      }

      // Defensive turn completion: a contact correction or an interrupted
      // frame must never leave an AI record with progress past 1.0 while the
      // car is still marked as turning. Such a record skips normal movement
      // forever and looks like a parked car at the corner.
      if (ai.isTurning && ai.turnProgress >= 1) {
        ai.isTurning = false;
        if (ai.turnEndPos) {
          car.x = ai.turnEndPos.x;
          car.y = ai.turnEndPos.y;
        }
        car.angle = ai.turnTargetAngle;
        car.turnSignal = 'none';
        if (ai.isUTurn) {
          ai.isUTurn = false;
        } else {
          ai.roadType = ai.roadType === 'vertical' ? 'horizontal' : 'vertical';
          ai.roadCoord = ai.targetRoadCoord;
          ai.parkingCoordinate = undefined;
        }
        ai.direction = ai.targetDirection;
      }

      // Clear intersection trigger once safely past
      if (ai.lastIntersectionId && !ai.isTurning) {
        const inter = this.cityMap.intersections.find((i) => i.id === ai.lastIntersectionId);
        if (inter && Math.hypot(inter.x - car.x, inter.y - car.y) > inter.size / 2 + CROSSWALK_DEPTH + 24) {
          ai.lastIntersectionId = undefined;
        }
      }

      if (ai.laneShift?.kind === 'park' && !ai.laneShift.released && parkingDistance !== undefined) {
        // Roll to a stop at the bay, slowly enough to complete the pull-in.
        targetSpeed = Math.min(targetSpeed, 1.2 + getStoppingCurveSpeed(config, parkingDistance));
        const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);
        const across = ai.roadType === 'vertical' ? car.x : car.y;
        const laneCoord = ai.roadType === 'vertical' ? lane.x! : lane.y!;
        if (Math.abs(across - (laneCoord + ai.laneShift.offset)) < 1.5) shouldStop = true;
      }

      // Approaching the capped end of an arterial: slow to a crawl on a
      // stopping curve so the turnaround below happens at walking pace. At
      // cruise speed the lane-keeping controller swung the U-turn wide, past
      // the end of the asphalt, and the spacing pass shoved the queue behind
      // it further off the road.
      if (!ai.isTurning) {
        const roadEndDistance = this.getRoadEndDistance(car, ai);
        if (roadEndDistance !== undefined) {
          const room = roadEndDistance - ROAD_END_TURN_DISTANCE;
          targetSpeed = Math.min(targetSpeed, ROAD_END_CRAWL_SPEED + getStoppingCurveSpeed(config, room));
          // Too fast to make the turn point on service braking: brake hard
          // rather than sail past the end of the asphalt.
          const excess = Math.max(0, car.speed - ROAD_END_CRAWL_SPEED);
          if (excess > 0.5 && room < (60 * excess ** 2) / (2 * config.braking * 0.72)) emergencyBrake = true;
          // At the turn point with the arc occupied: wait for a gap.
          if (room < 4 && !this.isRoadEndUTurnClear(car, this.planRoadEndUTurn(car, ai))) shouldStop = true;
        }
      }

      ai.holding = shouldStop || targetSpeed < 0.5;

      let reverseForRoom = false;
      if (ai.laneShift?.kind === 'bypass' && !ai.laneShift.released && !ai.isTurning) {
        const bypassControl = this.controlBypass(car, ai, cruiseSpeed, playerVehicle);
        if (bypassControl === 'reverse') reverseForRoom = true;
        else targetSpeed = Math.min(targetSpeed, bypassControl);
      }

      // 9. Speed Integration. NPCs use the same physically-scaled
      // acceleration/braking model as the player and only target the road
      // cruise speed chosen by the traffic controller.
      const speedBeforeIntegration = car.speed;
      if (reverseForRoom && !shouldStop) {
        // Creep back at walking pace to make room to pull out.
        car.speed = Math.max(-BYPASS_REVERSE_SPEED, integrateVehicleSpeed(car.speed, config, { reverse: true }, delta));
      } else {
        car.speed = integrateVehicleSpeed(car.speed, config, emergencyBrake
          ? { brake: true }
          : { targetSpeed: shouldStop ? 0 : targetSpeed }, delta);
      }
      car.isBraking = shouldStop || car.speed < speedBeforeIntegration - 0.01;
      car.isReversing = car.speed < -0.3;

      // 10. Straight Road Driving & Active Lane-Centering
      if (!ai.isTurning && ai.laneShift) {
        this.driveLaneShift(car, ai, delta);
      } else if (!ai.isTurning) {
        const targetLane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction, ai.laneIndex);

        // Integrate forward motion along current heading
        const vx = Math.cos(car.angle) * car.speed;
        const vy = Math.sin(car.angle) * car.speed;
        car.x += vx * 60 * delta;
        car.y += vy * 60 * delta;

        // Active Lane Keeping Controller
        if (ai.roadType === 'vertical') {
          // Align X to lane center
          car.x += (targetLane.x! - car.x) * Math.min(1.0, 4.0 * delta);
          // Align heading
          const diff = Math.atan2(Math.sin(targetLane.angle - car.angle), Math.cos(targetLane.angle - car.angle));
          car.angle += diff * Math.min(1.0, 4.8 * delta);
        } else {
          // Align Y to lane center
          car.y += (targetLane.y! - car.y) * Math.min(1.0, 4.0 * delta);
          // Align heading
          const diff = Math.atan2(Math.sin(targetLane.angle - car.angle), Math.cos(targetLane.angle - car.angle));
          car.angle += diff * Math.min(1.0, 4.8 * delta);
        }
      }

      // Turn around before reaching the capped road ends; never teleport
      // traffic from one side of the map to the other.
      if (!ai.isTurning) {
        const roadEndDistance = this.getRoadEndDistance(car, ai);
        if (roadEndDistance !== undefined && roadEndDistance < ROAD_END_TURN_DISTANCE) {
          const plan = this.planRoadEndUTurn(car, ai);
          if (this.isRoadEndUTurnClear(car, plan)) this.beginRoadEndUTurn(car, ai, plan);
        }
      }
    }

    // Rebuild the broad-phase after movement before the final queue-separation pass.
    this.vehicleIndex.clear();
    this.vehicleIndex.insertAll(this.npcVehicles);
    this.resolveNpcSpacing();
  }

  // Calculate Turn Path through Intersection
  private calculateIntersectionTurn(
    inter: Intersection,
    currentRoadType: 'vertical' | 'horizontal',
    currentDirection: TrafficDirection,
    isRightTurn: boolean,
    laneIndex: 0 | 1 = 0
  ): {
    endPos: { x: number; y: number };
    controlPos: { x: number; y: number };
    targetAngle: number;
    targetRoadCoord: number;
    targetDirection: TrafficDirection;
  } | null {
    const gx = inter.x;
    const gy = inter.y;
    const off = this.laneOffset + laneIndex * this.laneSpacing;

    if (currentRoadType === 'vertical') {
      if (currentDirection === 'south') {
        if (isRightTurn) {
          // South -> West
          return {
            endPos: { x: gx - 68, y: gy - off },
            controlPos: { x: gx + off, y: gy - off },
            targetAngle: Math.PI,
            targetRoadCoord: gy,
            targetDirection: 'west',
          };
        } else {
          // South -> East
          return {
            endPos: { x: gx + 68, y: gy + off },
            controlPos: { x: gx + off, y: gy + off },
            targetAngle: 0,
            targetRoadCoord: gy,
            targetDirection: 'east',
          };
        }
      } else {
        // north
        if (isRightTurn) {
          // North -> East
          return {
            endPos: { x: gx + 68, y: gy + off },
            controlPos: { x: gx - off, y: gy + off },
            targetAngle: 0,
            targetRoadCoord: gy,
            targetDirection: 'east',
          };
        } else {
          // North -> West
          return {
            endPos: { x: gx - 68, y: gy - off },
            controlPos: { x: gx - off, y: gy - off },
            targetAngle: Math.PI,
            targetRoadCoord: gy,
            targetDirection: 'west',
          };
        }
      }
    } else {
      // horizontal
      if (currentDirection === 'east') {
        if (isRightTurn) {
          // East -> South
          return {
            endPos: { x: gx + off, y: gy + 68 },
            controlPos: { x: gx + off, y: gy + off },
            targetAngle: Math.PI / 2,
            targetRoadCoord: gx,
            targetDirection: 'south',
          };
        } else {
          // East -> North
          return {
            endPos: { x: gx - off, y: gy - 68 },
            controlPos: { x: gx - off, y: gy + off },
            targetAngle: -Math.PI / 2,
            targetRoadCoord: gx,
            targetDirection: 'north',
          };
        }
      } else {
        // west
        if (isRightTurn) {
          // West -> North
          return {
            endPos: { x: gx - off, y: gy - 68 },
            controlPos: { x: gx - off, y: gy - off },
            targetAngle: -Math.PI / 2,
            targetRoadCoord: gx,
            targetDirection: 'north',
          };
        } else {
          // West -> South
          return {
            endPos: { x: gx + off, y: gy + 68 },
            controlPos: { x: gx + off, y: gy - off },
            targetAngle: Math.PI / 2,
            targetRoadCoord: gx,
            targetDirection: 'south',
          };
        }
      }
    }
  }

  // Update Pedestrians ("человечки")
  /**
   * Shared by the honk reaction and the new proactive danger check: pick one
   * stable point along the sidewalk to run to, away from (fromX, fromY).
   */
  private triggerPedestrianPanic(ped: Pedestrian, fromX: number, fromY: number) {
    const angleAway = Math.atan2(ped.y - fromY, ped.x - fromX);
    if (ped.walkRoadType === 'vertical') {
      const bounds = this.getPedestrianAxisBounds(ped.y, this.pedestrianCrossings(ped, 'vertical'));
      ped.panicTargetX = (ped.walkRoadCoord ?? ped.x) + (ped.walkSide ?? 108);
      ped.panicTargetY = ped.y >= fromY ? bounds.upper : bounds.lower;
    } else {
      const bounds = this.getPedestrianAxisBounds(ped.x, this.pedestrianCrossings(ped, 'horizontal'));
      ped.panicTargetX = ped.x >= fromX ? bounds.upper : bounds.lower;
      ped.panicTargetY = (ped.walkRoadCoord ?? ped.y) + (ped.walkSide ?? 108);
    }
    ped.panicTimer = 0.9;
    ped.panicCooldown = 1.5;
    ped.crosswalk = undefined;
    ped.state = 'fleeing';
    ped.angle = angleAway;
  }

  /**
   * Find a vehicle whose current, straight-line trajectory will overlap a
   * pedestrian's personal space soon.  This deliberately uses time to the
   * closest approach, rather than a simple proximity check: a car going
   * alongside the pavement is harmless, while a fast car on a collision
   * course is noticed before the physics body makes contact.
   */
  private findApproachingDanger(ped: Pedestrian, playerVehicle?: VehicleInstance | null) {
    const vehicles = playerVehicle ? [...this.npcVehicles, playerVehicle] : this.npcVehicles;
    let nearestDanger: { x: number; y: number; timeToClosestApproach: number } | null = null;

    for (const vehicle of vehicles) {
      if (vehicle.health <= 0 && !vehicle.isPlayer) continue;
      const dx = ped.x - vehicle.x;
      const dy = ped.y - vehicle.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.001) continue;

      // Vehicle speed is stored in world units per simulation tick, while
      // this prediction is expressed in seconds.
      const speedPerSecond = Math.abs(vehicle.speed) * 60;
      if (speedPerSecond < 270) continue; // slow parking/crawling is safe
      const vx = Math.cos(vehicle.angle) * vehicle.speed * 60;
      const vy = Math.sin(vehicle.angle) * vehicle.speed * 60;
      const closingSpeed = (vx * dx + vy * dy) / dist;
      if (closingSpeed < 270) continue;

      const speedSquared = vx * vx + vy * vy;
      const timeToClosestApproach = (vx * dx + vy * dy) / speedSquared;
      // Do not react after an already-missed contact; give people enough
      // time to visibly step away, without making them flee from traffic far
      // down the road.
      if (timeToClosestApproach < 0.18 || timeToClosestApproach > 1.4) continue;

      const closestX = dx - vx * timeToClosestApproach;
      const closestY = dy - vy * timeToClosestApproach;
      const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan;
      const safeClearance = Math.max(32, config.width / 2 + 18);
      if (Math.hypot(closestX, closestY) > safeClearance) continue;

      if (!nearestDanger || timeToClosestApproach < nearestDanger.timeToClosestApproach) {
        nearestDanger = { x: vehicle.x, y: vehicle.y, timeToClosestApproach };
      }
    }
    return nearestDanger;
  }

  public updatePedestrians(delta: number, playerX: number, playerY: number, playerHonking: boolean, playerVehicle?: VehicleInstance | null) {
    const dialogPhrases = [
      'Привет, КАМАЗист!',
      'Хороший денёк!',
      'Вот это мощный тягач!',
      'Эй, осторожнее на поворотах!',
      'Смотри на светофор!',
      'Уступаю дорогу!',
      'Красивый КАМАЗ!',
      'Удачи на маршруте!',
      'Привет!',
    ];

    const hornStarted = playerHonking && !this.wasPlayerHonking;
    this.wasPlayerHonking = playerHonking;

    for (const ped of this.pedestrians) {
      ped.panicCooldown = Math.max(0, (ped.panicCooldown || 0) - delta);
      // Speech timer
      if (ped.speechTimer > 0) {
        ped.speechTimer -= delta;
        if (ped.speechTimer <= 0) {
          ped.speechText = undefined;
        }
      }

      // Parking stops are small, visible trips rather than a hidden timer:
      // the driver walks away from the car, waits, then returns and boards.
      // Passenger pedestrians use the same state with a one-way trip into it.
      if (ped.parkingRole) {
        const parkedVehicle = ped.vehicleId
          ? this.npcVehicles.find((vehicle) => vehicle.id === ped.vehicleId)
          : undefined;
        const parkedAi = parkedVehicle ? this.aiData.get(parkedVehicle.id) : undefined;
        if (!parkedVehicle || !parkedAi || parkedVehicle.isCrashed) {
          ped.parkingRole = undefined;
          ped.vehicleId = undefined;
          ped.state = 'walking';
          ped.speed = 1.1;
          this.choosePedestrianWaypoint(ped);
          continue;
        }

        if (ped.parkingRole === 'waiting') {
          ped.parkingTimer = Math.max(0, (ped.parkingTimer || 0) - delta);
          ped.state = 'waiting';
          if (ped.parkingTimer <= 0) {
            if (parkedAi.abandonAfterParking) {
              // A minority of trips end here: the driver leaves the car at a
              // destination parking lot and continues on foot.
              ped.parkingRole = undefined;
              ped.vehicleId = undefined;
              ped.state = 'walking';
              ped.speed = 1.1;
              ped.lifeStage = 'sidewalk';
              this.choosePedestrianWaypoint(ped);
              continue;
            }
            ped.parkingRole = 'entering';
            ped.state = 'entering';
            ped.targetX = parkedVehicle.x;
            ped.targetY = parkedVehicle.y;
          }
          continue;
        }

        const distanceToParkingTarget = Math.hypot(ped.targetX - ped.x, ped.targetY - ped.y);
        if (distanceToParkingTarget <= 18) {
          if (ped.parkingRole === 'exiting') {
            ped.parkingRole = 'waiting';
            ped.state = 'waiting';
            ped.parkingTimer = 3.5;
          } else if (ped.id.startsWith('parking_driver_')) {
            ped.state = 'indoors';
            ped.parkingRole = undefined;
            ped.vehicleId = undefined;
            parkedAi.activity = 'driving';
            parkedAi.driveTimer = 0;
            parkedAi.parkingTimer = 0;
            parkedAi.parkingPoiId = undefined;
            parkedAi.parkingCoordinate = undefined;
            parkedAi.parkingSide = undefined;
            parkedAi.routeSourcePoiId = parkedAi.routeTargetPoiId;
            const nextPoi = this.cityMap.pois[
              (this.cityMap.pois.findIndex((poi) => poi.id === parkedAi.routeSourcePoiId) + 3) % this.cityMap.pois.length
            ];
            if (nextPoi && parkedAi.routeSourcePoiId) {
              parkedAi.routeTargetPoiId = nextPoi.id;
              parkedAi.routeRoadIds = this.cityMap.getRouteBetweenPois(parkedAi.routeSourcePoiId, nextPoi.id);
              parkedAi.routeIndex = 0;
            }
            parkedVehicle.npcParked = false;
            parkedVehicle.isBraking = false;
            // Pull out of the bay the way it pulled in: a gradual shift back
            // to the lane that waits for a gap in passing traffic.
            const parkedLane = this.getTargetLane(parkedAi.roadType, parkedAi.roadCoord, parkedAi.direction, parkedAi.laneIndex);
            const bayOffset = parkedAi.roadType === 'vertical'
              ? parkedVehicle.x - parkedLane.x!
              : parkedVehicle.y - parkedLane.y!;
            parkedAi.laneShift = { kind: 'park', targetId: '', offset: bayOffset, released: true };
          } else {
            // Passengers disappear into the vehicle; only the driver controls
            // when the parked NPC is allowed to resume driving.
            ped.state = 'indoors';
            ped.parkingRole = undefined;
            ped.vehicleId = undefined;
          }
          continue;
        }

        const parkingAngle = Math.atan2(ped.targetY - ped.y, ped.targetX - ped.x);
        ped.angle = parkingAngle;
        ped.state = ped.parkingRole === 'exiting' ? 'leaving' : 'entering';
        ped.x += Math.cos(parkingAngle) * ped.speed * 60 * delta;
        ped.y += Math.sin(parkingAngle) * ped.speed * 60 * delta;
        continue;
      }

      if (ped.isDriver) {
        const crashedVehicle = ped.vehicleId
          ? this.npcVehicles.find((vehicle) => vehicle.id === ped.vehicleId)
          : undefined;

        if (!crashedVehicle?.isCrashed) {
          ped.isDriver = false;
          ped.vehicleId = undefined;
          ped.state = 'walking';
          ped.speed = 1.1;
          this.choosePedestrianWaypoint(ped);
        } else {
          // The driver has left the wreck and stays beside it while the
          // complaint bubble is visible. No teleporting back into the car.
          ped.state = 'talking';
          ped.speed = 0;
          const distanceToArgument = Math.hypot(ped.targetX - ped.x, ped.targetY - ped.y);
          if (distanceToArgument > 26) {
            const argumentAngle = Math.atan2(ped.targetY - ped.y, ped.targetX - ped.x);
            ped.angle = argumentAngle;
            ped.x += Math.cos(argumentAngle) * 2.2 * 60 * delta;
            ped.y += Math.sin(argumentAngle) * 2.2 * 60 * delta;
          }
          continue;
        }
      }

      if (ped.state === 'indoors') {
        ped.indoorTimer = Math.max(0, (ped.indoorTimer || 0) - delta);
        if (ped.indoorTimer <= 0) {
          const entrance = ped.buildingId
            ? this.getBuildingEntrance(ped.buildingId, ped.walkRoadType || 'vertical', ped.walkRoadCoord ?? this.gridX[0], ped.walkSide ?? this.sidewalkOffset)
            : null;
          if (entrance) {
            ped.state = 'leaving';
            ped.lifeStage = 'toDoor';
            ped.x = entrance.doorX;
            ped.y = entrance.doorY;
            ped.targetX = entrance.sidewalkX;
            ped.targetY = entrance.sidewalkY;
          } else {
            ped.state = 'walking';
            ped.lifeStage = 'sidewalk';
            this.choosePedestrianWaypoint(ped);
          }
        }
        continue;
      }

      // Ragdoll Physics Recovery
      if (ped.state === 'ragdoll') {
        ped.ragdollTimer -= delta;
        ped.x += ped.vx * 60 * delta;
        ped.y += ped.vy * 60 * delta;
        ped.vx *= 0.92;
        ped.vy *= 0.92;

        if (ped.ragdollTimer <= 0) {
          ped.state = 'walking';
          ped.speechText = 'Ух, задело... Живой!';
          ped.speechTimer = 2.5;
        }
        continue;
      }

      const distToPlayer = Math.hypot(playerX - ped.x, playerY - ped.y);

      // A horn is an edge-triggered event. While the key is held, the
      // pedestrian follows one stable escape target instead of recalculating
      // a new direction every frame and visibly vibrating in place.
      if ((ped.panicTimer || 0) > 0) {
        const panicTargetX = ped.panicTargetX ?? ped.x;
        const panicTargetY = ped.panicTargetY ?? ped.y;
        const panicDistance = Math.hypot(panicTargetX - ped.x, panicTargetY - ped.y);
        if (panicDistance > 18) {
          const panicAngle = Math.atan2(panicTargetY - ped.y, panicTargetX - ped.x);
          ped.state = 'fleeing';
          ped.angle = panicAngle;
          ped.speed = 2.0;
          ped.x += Math.cos(panicAngle) * ped.speed * 60 * delta;
          ped.y += Math.sin(panicAngle) * ped.speed * 60 * delta;
        } else {
          ped.panicTimer = 0;
          ped.state = 'walking';
          ped.speed = 1.1;
        }
        ped.panicTimer = Math.max(0, (ped.panicTimer || 0) - delta);
        continue;
      }

      // Reaction to player honk or close presence
      if (distToPlayer < 110 && (hornStarted || Math.random() < 0.0015) && (ped.panicCooldown || 0) <= 0) {
        if (ped.speechTimer <= 0) {
          ped.speechText = dialogPhrases[Math.floor(Math.random() * dialogPhrases.length)];
          ped.speechTimer = 3.2;
        }
        this.triggerPedestrianPanic(ped, playerX, playerY);
        continue;
      }

      // Proactive danger reaction: any vehicle (not only an honking player)
      // closing in fast enough to be a real near-miss. Silent traffic used
      // to be invisible to pedestrians even bearing straight down on them.
      if ((ped.panicCooldown || 0) <= 0) {
        const danger = this.findApproachingDanger(ped, playerVehicle);
        if (danger) {
          if (ped.speechTimer <= 0) {
            ped.speechText = 'Куда прёшь?!';
            ped.speechTimer = 2.2;
          }
          this.triggerPedestrianPanic(ped, danger.x, danger.y);
          continue;
        }
      }

      if (this.updatePedestrianCrosswalk(ped, delta)) continue;

      // Standard sidewalk pathfinding
      const distToTarget = Math.hypot(ped.targetX - ped.x, ped.targetY - ped.y);
      if (distToTarget < 18) {
        if (ped.lifeStage === 'toSidewalk' && ped.buildingId) {
          const entrance = this.getBuildingEntrance(ped.buildingId, ped.walkRoadType || 'vertical', ped.walkRoadCoord ?? this.gridX[0], ped.walkSide ?? this.sidewalkOffset);
          if (entrance) {
            ped.lifeStage = 'toDoor';
            ped.state = 'entering';
            ped.targetX = entrance.doorX;
            ped.targetY = entrance.doorY;
            continue;
          }
        }
        if (ped.lifeStage === 'toDoor' && ped.state === 'entering') {
          ped.state = 'indoors';
          ped.lifeStage = 'indoors';
          ped.indoorTimer = 7 + (Number(ped.id.replace(/\D/g, '')) % 12);
          ped.speed = 0;
          continue;
        }
        if (ped.lifeStage === 'toDoor' && ped.state === 'leaving') {
          ped.state = 'walking';
          ped.lifeStage = 'sidewalk';
          ped.speed = 1.1;
          if (!this.assignBuildingTrip(ped)) this.choosePedestrianWaypoint(ped);
          continue;
        }
        // Pick new waypoint along sidewalks
        this.choosePedestrianWaypoint(ped);
      } else {
        const moveAngle = Math.atan2(ped.targetY - ped.y, ped.targetX - ped.x);
        ped.angle = moveAngle;
        ped.x += Math.cos(moveAngle) * ped.speed * 60 * delta;
        ped.y += Math.sin(moveAngle) * ped.speed * 60 * delta;
        if (ped.lifeStage !== 'toDoor' && ped.walkRoadType === 'vertical') {
          const bounds = this.getPedestrianAxisBounds(ped.y, this.pedestrianCrossings(ped, 'vertical'));
          ped.x = (ped.walkRoadCoord ?? ped.x) + (ped.walkSide ?? 108);
          ped.y = Math.max(bounds.lower, Math.min(bounds.upper, ped.y));
        } else if (ped.lifeStage !== 'toDoor') {
          const bounds = this.getPedestrianAxisBounds(ped.x, this.pedestrianCrossings(ped, 'horizontal'));
          ped.y = (ped.walkRoadCoord ?? ped.y) + (ped.walkSide ?? 108);
          ped.x = Math.max(bounds.lower, Math.min(bounds.upper, ped.x));
        }
      }
    }
  }
}
