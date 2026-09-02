import { Pedestrian, VehicleInstance } from '../types';
import { CityMap, Intersection, RoadSegment, WORLD_SIZE } from './cityMap';
import { KMH_TO_WORLD_SPEED, VEHICLE_CONFIGS } from './vehicleConfigs';

export type TrafficDirection = 'north' | 'south' | 'east' | 'west';

interface NPCAIExtra {
  roadType: 'vertical' | 'horizontal';
  roadCoord: number; // gx or gy coordinate
  direction: TrafficDirection;
  isTurning: boolean;
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
}

export class TrafficAI {
  public npcVehicles: VehicleInstance[] = [];
  public pedestrians: Pedestrian[] = [];
  private aiData: Map<string, NPCAIExtra> = new Map();
  private intersectionReservations: Map<string, string> = new Map();
  private intersectionReservationAge: Map<string, number> = new Map();

  private cityMap: CityMap;
  private maxCars = 40;
  private maxPedestrians = 35;

  private gridX = [600, 1400, 2200, 3000];
  private gridY = [600, 1400, 2200, 3000];
  private laneOffset = 34;

  constructor(cityMap: CityMap) {
    this.cityMap = cityMap;
    this.spawnInitialTraffic();
    this.spawnInitialPedestrians();
  }

  private getTargetLane(roadType: 'vertical' | 'horizontal', roadCoord: number, direction: TrafficDirection) {
    if (roadType === 'vertical') {
      return {
        x: direction === 'south' ? roadCoord + this.laneOffset : roadCoord - this.laneOffset,
        angle: direction === 'south' ? Math.PI / 2 : -Math.PI / 2,
      };
    } else {
      return {
        y: direction === 'east' ? roadCoord + this.laneOffset : roadCoord - this.laneOffset,
        angle: direction === 'east' ? 0 : Math.PI,
      };
    }
  }

  private getIntersectionApproachDistance(
    car: VehicleInstance,
    ai: NPCAIExtra,
    inter: Intersection
  ): number | null {
    const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction);

    if (ai.roadType === 'vertical') {
      if (Math.abs(inter.x - ai.roadCoord) > 70) return null;
      if (Math.abs(car.x - lane.x!) > 52) return null;
      return ai.direction === 'south' ? inter.y - car.y : car.y - inter.y;
    }

    if (Math.abs(inter.y - ai.roadCoord) > 70) return null;
    if (Math.abs(car.y - lane.y!) > 52) return null;
    return ai.direction === 'east' ? inter.x - car.x : car.x - inter.x;
  }

  private getActiveIntersection(car: VehicleInstance, ai: NPCAIExtra) {
    if (ai.isTurning && ai.lastIntersectionId) {
      const turningIntersection = this.cityMap.intersections.find((inter) => inter.id === ai.lastIntersectionId);
      if (turningIntersection) return { inter: turningIntersection, approachDistance: 0 };
    }

    let active: { inter: Intersection; approachDistance: number } | null = null;
    for (const inter of this.cityMap.intersections) {
      const approachDistance = this.getIntersectionApproachDistance(car, ai, inter);
      if (approachDistance === null || approachDistance < -120 || approachDistance > 190) continue;
      if (!active || Math.abs(approachDistance) < Math.abs(active.approachDistance)) {
        active = { inter, approachDistance };
      }
    }
    return active;
  }

  private startGroundBypass(car: VehicleInstance, ai: NPCAIExtra, inter: Intersection) {
    if (ai.groundBypass || ai.isTurning) return;

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
    const targetLane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction);
    const rejoinPoint = ai.roadType === 'vertical'
      ? { x: targetLane.x!, y: pastPoint.y }
      : { x: pastPoint.x, y: targetLane.y! };

    ai.groundBypass = {
      intersectionId: inter.id,
      waypoints: [sidePoint, pastPoint, rejoinPoint],
      waypointIndex: 0,
    };
    ai.progressTimer = 0;
    ai.stuckTimer = 0;
    car.isBraking = false;
    car.turnSignal = 'hazard';
  }

  private updateGroundBypass(car: VehicleInstance, ai: NPCAIExtra, delta: number, cruiseSpeed: number) {
    const bypass = ai.groundBypass;
    if (!bypass) return false;

    const waypoint = bypass.waypoints[bypass.waypointIndex];
    if (!waypoint) {
      ai.groundBypass = undefined;
      car.turnSignal = 'none';
      car.angle = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction).angle;
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
    const desiredAngle = Math.atan2(dy, dx);
    const angleDelta = Math.atan2(
      Math.sin(desiredAngle - car.angle),
      Math.cos(desiredAngle - car.angle)
    );
    car.angle += angleDelta * Math.min(1, 8 * delta);
    car.speed = Math.min(bypassSpeed, distance / Math.max(delta * 60, 1));
    car.isBraking = false;
    car.turnSignal = 'hazard';
    car.x += Math.cos(car.angle) * car.speed * 60 * delta;
    car.y += Math.sin(car.angle) * car.speed * 60 * delta;
    return true;
  }

  private getStopLineCoordinate(car: VehicleInstance, ai: NPCAIExtra, inter: Intersection) {
    const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
    const distanceFromCenter = inter.size / 2 + config.length / 2 + 8;

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

    const firstLane = this.getTargetLane(first.roadType, first.roadCoord, first.direction);
    const secondLane = this.getTargetLane(second.roadType, second.roadCoord, second.direction);
    return first.roadType === 'vertical'
      ? Math.abs(firstLane.x! - secondLane.x!) < 10
      : Math.abs(firstLane.y! - secondLane.y!) < 10;
  }

  private resolveNpcSpacing() {
    // Dense queues can form chains, so repeat the pair pass until each
    // correction has propagated through the local group.
    for (let pass = 0; pass < 24; pass += 1) {
      for (let i = 0; i < this.npcVehicles.length; i += 1) {
        const first = this.npcVehicles[i];
        if (first.health <= 0 || first.isCrashed) continue;
        const firstConfig = VEHICLE_CONFIGS[first.type] || VEHICLE_CONFIGS.sedan;

        for (let j = i + 1; j < this.npcVehicles.length; j += 1) {
          const second = this.npcVehicles[j];
          if (second.health <= 0 || second.isCrashed) continue;
          const secondConfig = VEHICLE_CONFIGS[second.type] || VEHICLE_CONFIGS.sedan;
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const distance = Math.hypot(dx, dy);
          // Keep same-heading traffic ordered along its lane. Choosing the
          // yielding vehicle by id alone can move the lead car forward and
          // make the following car catch it again on the next frame.
          const angleDifference = Math.atan2(
            Math.sin(second.angle - first.angle),
            Math.cos(second.angle - first.angle)
          );
          const sameHeading = Math.abs(angleDifference) < 0.25;
          const firstAi = this.aiData.get(first.id);
          const secondAi = this.aiData.get(second.id);
          const sameRoadOppositeLane = Boolean(
            firstAi && secondAi &&
              !firstAi.isTurning && !secondAi.isTurning &&
              firstAi.roadType === secondAi.roadType &&
              firstAi.roadCoord === secondAi.roadCoord &&
              firstAi.direction !== secondAi.direction
          );
          const firstRadius = Math.hypot(firstConfig.length / 2, firstConfig.width / 2);
          const secondRadius = Math.hypot(secondConfig.length / 2, secondConfig.width / 2);
          const minDistance = sameHeading
            ? (firstConfig.length + secondConfig.length) / 2 + 8
            : sameRoadOppositeLane
            ? (firstConfig.width + secondConfig.width) / 2 + 6
            : firstRadius + secondRadius + 2;
          if (distance >= minDistance) continue;

          // Keep a small numerical buffer because several neighbouring pairs
          // can be corrected during the same pass.
          const separation = minDistance - distance + 3;

          const forwardGap = dx * Math.cos(first.angle) + dy * Math.sin(first.angle);
          const yielding = sameHeading && Math.abs(forwardGap) > 0.5
            ? (forwardGap > 0 ? first : second)
            : (first.id > second.id ? first : second);

          if (sameHeading) {
            const headingX = Math.cos(yielding.angle);
            const headingY = Math.sin(yielding.angle);
            yielding.x -= headingX * separation;
            yielding.y -= headingY * separation;
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
      this.aiData.set(carId, {
        roadType: isVert ? 'vertical' : 'horizontal',
        roadCoord,
        direction,
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
      const side = (i % 4 < 2 ? 1 : -1) * 82; // Sidewalk position
      const spread = 280 + (i * 240) % (WORLD_SIZE - 560);

      const px = isVert ? roadCoord + side : spread;
      const py = isVert ? spread : roadCoord + side;

      this.pedestrians.push({
        id: `ped_${i}`,
        x: px,
        y: py,
        angle: Math.random() * Math.PI * 2,
        speed: 1.1 + Math.random() * 0.8,
        targetX: px + (Math.random() * 200 - 100),
        targetY: py + (Math.random() * 200 - 100),
        state: 'walking',
        health: 100,
        skinColor: skinColors[i % skinColors.length],
        shirtColor: shirtColors[i % shirtColors.length],
        pantsColor: pantsColors[i % pantsColors.length],
        speechTimer: 0,
        ragdollTimer: 0,
        vx: 0,
        vy: 0,
      });
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
        });
      }
    });
  }

  // Update NPC Traffic Simulation
  public updateTraffic(delta: number, playerVehicle?: VehicleInstance | null) {
    const sirenActive = Boolean(playerVehicle && playerVehicle.isSiren);
    this.cleanupIntersectionReservations(delta);

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
        };
        this.aiData.set(car.id, ai);
      }

      const config = VEHICLE_CONFIGS[car.type] || VEHICLE_CONFIGS.sedan;
      const cruiseSpeed = Math.min(15, Math.max(8, config.maxSpeed * KMH_TO_WORLD_SPEED * 0.58));
      if (this.updateGroundBypass(car, ai, delta, cruiseSpeed)) {
        ai.lastX = car.x;
        ai.lastY = car.y;
        continue;
      }
      const movementSinceLastTick = Math.hypot(car.x - ai.lastX, car.y - ai.lastY);
      ai.progressTimer = movementSinceLastTick < 0.2 ? ai.progressTimer + delta : 0;
      ai.lastX = car.x;
      ai.lastY = car.y;
      // Traffic uses the same world-unit scale as the player physics. Keeping
      // NPCs below 16 px/frame leaves enough distance to react to a light and
      // prevents the first frame burst from turning into a traffic pile-up.
      let targetSpeed = cruiseSpeed;
      let shouldStop = false;
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
          const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction);
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
          let distAxis = 9999;
          let lightState: 'red' | 'yellow' | 'green' = 'green';

          if (ai.roadType === 'vertical' && Math.abs(car.x - inter.x) < 55) {
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
          } else if (ai.roadType === 'horizontal' && Math.abs(car.y - inter.y) < 55) {
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
      let blockedBySameLaneTraffic = false;
      let blockedByPlayer = false;
      const activeIntersection = this.getActiveIntersection(car, ai);
      if (!ai.isTurning) {
        const allObstacles = playerVehicle ? [...this.npcVehicles, playerVehicle] : this.npcVehicles;
        for (const other of allObstacles) {
          if (other.id === car.id) continue;
          if (!other.isPlayer && (other.health <= 0 || other.isCrashed)) continue;

          // Perpendicular cars are governed by the intersection reservation
          // system. Treating them as a same-lane obstacle here made a car at
          // the stop line brake for a vehicle crossing in front of it, which
          // could freeze both approaches for an entire light cycle.
          if (!other.isPlayer) {
            const otherAi = this.aiData.get(other.id);
            if (!otherAi || !this.areSameTrafficLane(ai, otherAi)) continue;
          }

            const dx = other.x - car.x;
            const dy = other.y - car.y;
            const dist = Math.hypot(dx, dy);

          if (dist < 80 && dist > 1) {
            const forwardX = Math.cos(car.angle);
            const forwardY = Math.sin(car.angle);
            const dot = (dx * forwardX + dy * forwardY) / dist;

            if (dot > 0.82) {
              const otherConfig = VEHICLE_CONFIGS[other.type] || VEHICLE_CONFIGS.sedan;
              const safeFollowingDistance = (config.length + otherConfig.length) * 0.38 + 6;
              if (dist < safeFollowingDistance) {
                shouldStop = true;
                blockedBySameLaneTraffic = true;
                if (other.isPlayer) blockedByPlayer = true;
                if (dist < 26 && !car.isHonking && Math.random() < 0.04) {
                  car.isHonking = true;
                  setTimeout(() => {
                    car.isHonking = false;
                  }, 500);
                }
              } else {
                targetSpeed = Math.min(targetSpeed, Math.max(0, (other.speed || 0) * 0.85));
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
      if (blockedByPlayer && activeIntersection && ai.progressTimer > 2.5) {
        this.startGroundBypass(car, ai, activeIntersection.inter);
        continue;
      }

      // Braking alone is not enough when a car reaches a stop line at the
      // end of a frame. Clamp its centre behind the line so a queue never
      // waits on a crosswalk or in the conflict zone.
      if (shouldStop && stopLineIntersection && !ai.isTurning) {
        this.holdAtStopLine(car, ai, stopLineIntersection);
        car.speed = 0;
      }

      // 6. Pedestrian Safety Braking
      for (const ped of this.pedestrians) {
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
      const nearIntersection = this.cityMap.intersections.some(
        (inter) => Math.hypot(inter.x - car.x, inter.y - car.y) < 150
      );
      if (ai.progressTimer > 0.75 && !ai.isTurning) {
        ai.stuckTimer += delta;
        const stuckLimit = nearIntersection ? 12 : 2.5;
        if (
          ai.progressTimer > stuckLimit &&
          (!waitingForTrafficLight || !blockedBySameLaneTraffic || ai.progressTimer > 18)
        ) {
          ai.stuckTimer = 0;
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

          const lane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction);
          if (ai.roadType === 'vertical') car.x = lane.x!;
          else car.y = lane.y!;
          // Pull a deadlocked car back along its own lane instead of teleporting
          // it sideways through the junction. This is only reached after a
          // long stationary timeout, so it is a recovery path, not normal AI.
          car.x -= Math.cos(car.angle) * 42;
          car.y -= Math.sin(car.angle) * 42;
          car.angle = lane.angle;
          car.speed = waitingForTrafficLight ? 0 : cruiseSpeed * 0.8;
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
          const dInter = Math.hypot(inter.x - car.x, inter.y - car.y);

          // Check if right at intersection entrance
          if (dInter < 52 && ai.lastIntersectionId !== inter.id) {
            ai.lastIntersectionId = inter.id;

            const roll = Math.random();
            if (roll < 0.32) {
              // Decide Turn: Left or Right
              const isRightTurn = roll < 0.16;
              const turnResult = this.calculateIntersectionTurn(
                inter,
                ai.roadType,
                ai.direction,
                isRightTurn
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
              }
            } else {
              // Straight
              car.turnSignal = 'none';
            }
            break;
          }
        }
      }

      // 8. Execute Smooth Bezier Intersection Turn
      if (ai.isTurning && ai.turnStartPos && ai.turnEndPos && ai.turnControlPos) {
        targetSpeed = Math.min(targetSpeed, 12.0);
        ai.turnProgress += Math.max(0.012, (car.speed * 0.12) * delta);

        if (ai.turnProgress >= 1.0) {
          // Completed turn: transfer directly to destination lane
          ai.isTurning = false;
          car.x = ai.turnEndPos.x;
          car.y = ai.turnEndPos.y;
          car.angle = ai.turnTargetAngle;
          car.turnSignal = 'none';

          ai.roadType = ai.roadType === 'vertical' ? 'horizontal' : 'vertical';
          ai.roadCoord = ai.targetRoadCoord;
          ai.direction = ai.targetDirection;
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
        ai.roadType = ai.roadType === 'vertical' ? 'horizontal' : 'vertical';
        ai.roadCoord = ai.targetRoadCoord;
        ai.direction = ai.targetDirection;
      }

      // Clear intersection trigger once safely past
      if (ai.lastIntersectionId) {
        const inter = this.cityMap.intersections.find((i) => i.id === ai.lastIntersectionId);
        if (inter && Math.hypot(inter.x - car.x, inter.y - car.y) > 95) {
          ai.lastIntersectionId = undefined;
        }
      }

      // 9. Speed Integration
      if (shouldStop) {
        car.isBraking = true;
        car.speed = Math.max(0, car.speed - config.braking * KMH_TO_WORLD_SPEED * 1.6 * delta);
      } else {
        car.isBraking = false;
        if (car.speed < targetSpeed) {
          car.speed = Math.min(
            targetSpeed,
            car.speed + config.acceleration * KMH_TO_WORLD_SPEED * 0.9 * delta
          );
        } else if (car.speed > targetSpeed) {
          car.speed = Math.max(
            targetSpeed,
            car.speed - config.braking * KMH_TO_WORLD_SPEED * 0.5 * delta
          );
        }
      }

      // 10. Straight Road Driving & Active Lane-Centering
      if (!ai.isTurning) {
        const targetLane = this.getTargetLane(ai.roadType, ai.roadCoord, ai.direction);

        // Integrate forward motion along current heading
        const vx = Math.cos(car.angle) * car.speed;
        const vy = Math.sin(car.angle) * car.speed;
        car.x += vx * 60 * delta;
        car.y += vy * 60 * delta;

        // Active Lane Keeping Controller
        if (ai.roadType === 'vertical') {
          // Align X to lane center
          car.x += (targetLane.x! - car.x) * Math.min(1.0, 5.0 * delta);
          // Align heading
          const diff = Math.atan2(Math.sin(targetLane.angle - car.angle), Math.cos(targetLane.angle - car.angle));
          car.angle += diff * Math.min(1.0, 6.0 * delta);
        } else {
          // Align Y to lane center
          car.y += (targetLane.y! - car.y) * Math.min(1.0, 5.0 * delta);
          // Align heading
          const diff = Math.atan2(Math.sin(targetLane.angle - car.angle), Math.cos(targetLane.angle - car.angle));
          car.angle += diff * Math.min(1.0, 6.0 * delta);
        }
      }

      // 11. World boundary seamless wrap
      if (car.x < 80) {
        car.x = WORLD_SIZE - 100;
      }
      if (car.x > WORLD_SIZE - 80) {
        car.x = 100;
      }
      if (car.y < 80) {
        car.y = WORLD_SIZE - 100;
      }
      if (car.y > WORLD_SIZE - 80) {
        car.y = 100;
      }
    }

    this.resolveNpcSpacing();
  }

  // Calculate Turn Path through Intersection
  private calculateIntersectionTurn(
    inter: Intersection,
    currentRoadType: 'vertical' | 'horizontal',
    currentDirection: TrafficDirection,
    isRightTurn: boolean
  ): {
    endPos: { x: number; y: number };
    controlPos: { x: number; y: number };
    targetAngle: number;
    targetRoadCoord: number;
    targetDirection: TrafficDirection;
  } | null {
    const gx = inter.x;
    const gy = inter.y;
    const off = this.laneOffset;

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
  public updatePedestrians(delta: number, playerX: number, playerY: number, playerHonking: boolean) {
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

    for (const ped of this.pedestrians) {
      // Speech timer
      if (ped.speechTimer > 0) {
        ped.speechTimer -= delta;
        if (ped.speechTimer <= 0) {
          ped.speechText = undefined;
        }
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
          ped.targetX = Math.max(90, Math.min(WORLD_SIZE - 90, ped.x + Math.cos(ped.angle) * 120));
          ped.targetY = Math.max(90, Math.min(WORLD_SIZE - 90, ped.y + Math.sin(ped.angle) * 120));
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

      // Reaction to player honk or close presence
      if (distToPlayer < 110 && (playerHonking || Math.random() < 0.0015)) {
        if (ped.speechTimer <= 0) {
          ped.speechText = dialogPhrases[Math.floor(Math.random() * dialogPhrases.length)];
          ped.speechTimer = 3.2;
        }

        // Sidestep away
        const angleAway = Math.atan2(ped.y - playerY, ped.x - playerX);
        ped.angle = angleAway;
        ped.x += Math.cos(angleAway) * (ped.speed * 1.6) * 60 * delta;
        ped.y += Math.sin(angleAway) * (ped.speed * 1.6) * 60 * delta;
        continue;
      }

      // Standard sidewalk pathfinding
      const distToTarget = Math.hypot(ped.targetX - ped.x, ped.targetY - ped.y);
      if (distToTarget < 25) {
        // Pick new waypoint along sidewalks
        ped.targetX = Math.max(90, Math.min(WORLD_SIZE - 90, ped.x + (Math.random() * 320 - 160)));
        ped.targetY = Math.max(90, Math.min(WORLD_SIZE - 90, ped.y + (Math.random() * 320 - 160)));
      } else {
        const moveAngle = Math.atan2(ped.targetY - ped.y, ped.targetX - ped.x);
        ped.angle = moveAngle;
        ped.x += Math.cos(moveAngle) * ped.speed * 60 * delta;
        ped.y += Math.sin(moveAngle) * ped.speed * 60 * delta;
      }
    }
  }
}
