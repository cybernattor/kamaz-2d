import {
  DestructibleObject,
  Particle,
  Pedestrian,
  PlayerCharacter,
  SkidMark,
  VehicleInstance,
} from '../types';
import { KMH_TO_WORLD_SPEED, VEHICLE_CONFIGS } from './vehicleConfigs';
import { Building, CityMap, WORLD_SIZE } from './cityMap';
import { sound } from '../audio/soundEngine';

export interface CollisionEvent {
  type: 'vehicle_vehicle' | 'vehicle_prop' | 'vehicle_ped' | 'vehicle_building';
  impactSpeed: number;
  x: number;
  y: number;
}

export type VehicleCrashHandler = (
  event: CollisionEvent,
  firstVehicle: VehicleInstance,
  secondVehicle?: VehicleInstance
) => void;

export class PhysicsEngine {
  public skidMarks: SkidMark[] = [];
  public particles: Particle[] = [];

  private maxSkidMarks = 500;
  private maxParticles = 800;
  private lastImpactTime: Map<string, number> = new Map();

  // Update Player Vehicle with Realistic Kinematics & Physics
  public updatePlayerVehicle(
    vehicle: VehicleInstance,
    inputs: {
      throttle: boolean;
      brake: boolean;
      reverse: boolean;
      steerLeft: boolean;
      steerRight: boolean;
      handbrake: boolean;
    },
    delta: number
  ) {
    const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.kamaz_dump;
    const isDestroyed = vehicle.health <= 0;

    // 1. Dynamic Steering Kinematics (Responsive & Speed-sensitive)
    const speedKmh = Math.abs(vehicle.speed) * 3.6;
    const speedFactor = Math.max(0.55, 1.0 - (speedKmh / (config.maxSpeed * 1.4)) * 0.45);
    const maxSteerAngle = 0.72 * speedFactor; // Up to ~41 degrees at low/medium speeds
    const steerSpeed = 6.8;
    let targetSteer = 0;

    if (!isDestroyed) {
      if (inputs.steerLeft) targetSteer -= maxSteerAngle;
      if (inputs.steerRight) targetSteer += maxSteerAngle;
    }

    // Smooth steering centering with fast response
    vehicle.steeringAngle += (targetSteer - vehicle.steeringAngle) * steerSpeed * delta;

    // 2. Engine Acceleration & Power Delivery
    let accel = 0;
    const maxForward = config.maxSpeed * KMH_TO_WORLD_SPEED;
    const maxReverse = -config.reverseSpeed * KMH_TO_WORLD_SPEED;
    const speedRatio = Math.max(0, vehicle.speed / (maxForward || 1));

    // Damaged engine power loss
    const healthPowerFactor = vehicle.health < 30 ? 0.6 : vehicle.health < 60 ? 0.85 : 1.0;

    if (!isDestroyed) {
      if (inputs.throttle) {
        // High torque pull at low-mid range for heavy trucks
        const torque = Math.max(0.2, 1.0 - Math.pow(speedRatio, 1.3));
        accel = config.acceleration * KMH_TO_WORLD_SPEED * torque * healthPowerFactor;
      } else if (inputs.reverse || (inputs.brake && vehicle.speed <= 0.3)) {
        accel = -config.reverseSpeed * KMH_TO_WORLD_SPEED * 0.9 * healthPowerFactor;
      }
    }

    // 3. Foot Brake & Handbrake Physics
    // Drag is time-based so handling remains stable at different frame rates.
    let rollingResistance = Math.exp(-1.0 * delta);
    vehicle.isBraking = false;
    vehicle.isReversing = vehicle.speed < -0.3;

    if (inputs.brake && vehicle.speed > 0.3) {
      vehicle.isBraking = true;
      vehicle.speed -= config.braking * KMH_TO_WORLD_SPEED * 1.2 * delta;
      if (vehicle.speed < 0) vehicle.speed = 0;
    }

    // Handbrake drift physics
    let isDrifting = false;
    if (inputs.handbrake) {
      vehicle.isBraking = true;
      rollingResistance = Math.exp(-4.5 * delta) * config.driftFriction;
      if (Math.abs(vehicle.speed) > 2.5) {
        isDrifting = true;
      }
    }

    // Apply engine acceleration & natural friction
    vehicle.speed += accel * delta;
    vehicle.speed *= rollingResistance;

    // Enforce top speeds
    if (vehicle.speed > maxForward) vehicle.speed = maxForward;
    if (vehicle.speed < maxReverse) vehicle.speed = maxReverse;

    // 4. Angular Velocity & Direct Responsive Turning
    const isMoving = Math.abs(vehicle.speed) > 0.01;
    if (isMoving) {
      const speedSign = vehicle.speed >= 0 ? 1 : -1;
      const turnEff = Math.max(0.45, Math.min(1.2, Math.abs(vehicle.speed) / 6.0));
      const driftMultiplier = isDrifting ? (config.id === 'sports' ? 2.3 : 1.7) : 1.0;
      
      // Responsive angular velocity
      vehicle.angularVelocity = vehicle.steeringAngle * speedSign * turnEff * (config.turnSpeed * 1.15) * driftMultiplier;
      vehicle.angle += vehicle.angularVelocity * delta;
    } else if (Math.abs(vehicle.steeringAngle) > 0.08 && (inputs.throttle || inputs.reverse)) {
      // Gentle rotation when beginning to move from standstill
      const rollDir = inputs.throttle ? 1 : -1;
      vehicle.angle += vehicle.steeringAngle * rollDir * 1.4 * delta;
    } else {
      vehicle.angularVelocity = 0;
    }

    // 5. Position Integration (with lateral slip drift)
    let forwardVx = Math.cos(vehicle.angle) * vehicle.speed;
    let forwardVy = Math.sin(vehicle.angle) * vehicle.speed;

    // Lateral slide component during high-g cornering or handbrake
    if (isDrifting) {
      const lateralDirX = -Math.sin(vehicle.angle);
      const lateralDirY = Math.cos(vehicle.angle);
      const slipAmount = vehicle.steeringAngle * vehicle.speed * 0.32;
      forwardVx += lateralDirX * slipAmount;
      forwardVy += lateralDirY * slipAmount;
    }

    vehicle.x += forwardVx * 60 * delta;
    vehicle.y += forwardVy * 60 * delta;

    // 6. World Bounds containment
    vehicle.x = Math.max(80, Math.min(WORLD_SIZE - 80, vehicle.x));
    vehicle.y = Math.max(80, Math.min(WORLD_SIZE - 80, vehicle.y));

    // 7. Skid marks & Tire sounds
    const isHardBraking = inputs.brake && vehicle.speed > 10;
    if (isDrifting || isHardBraking) {
      this.generateSkidMarks(vehicle, config.width, config.length);
      sound.updateSkid(true, isDrifting ? 0.85 : 0.45);
    } else {
      sound.updateSkid(false);
    }

    // 8. Damage smoke & fire emitter
    if (vehicle.health < 50) {
      vehicle.smokeTimer = (vehicle.smokeTimer || 0) + delta;
      const interval = vehicle.health < 20 ? 0.04 : 0.08;
      if (vehicle.smokeTimer > interval) {
        vehicle.smokeTimer = 0;
        this.emitDamageSmoke(vehicle, vehicle.health < 22);
      }
    }
  }

  // Generate dual tire skid marks behind vehicle
  private generateSkidMarks(vehicle: VehicleInstance, width: number, length: number) {
    const rearOffsetX = -Math.cos(vehicle.angle) * (length * 0.38);
    const rearOffsetY = -Math.sin(vehicle.angle) * (length * 0.38);
    const halfWidth = width * 0.42;
    const perpX = -Math.sin(vehicle.angle) * halfWidth;
    const perpY = Math.cos(vehicle.angle) * halfWidth;

    const leftWheelX = vehicle.x + rearOffsetX + perpX;
    const leftWheelY = vehicle.y + rearOffsetY + perpY;
    const rightWheelX = vehicle.x + rearOffsetX - perpX;
    const rightWheelY = vehicle.y + rearOffsetY - perpY;

    if (this.skidMarks.length > this.maxSkidMarks) {
      this.skidMarks.splice(0, 2);
    }

    const prevLeft = this.skidMarks[this.skidMarks.length - 2];
    if (prevLeft && Math.hypot(leftWheelX - prevLeft.x2, leftWheelY - prevLeft.y2) < 40) {
      this.skidMarks.push({
        x1: prevLeft.x2,
        y1: prevLeft.y2,
        x2: leftWheelX,
        y2: leftWheelY,
        alpha: 0.42,
        width: 3.8,
      });
      this.skidMarks.push({
        x1: prevLeft.x2 - perpX * 2,
        y1: prevLeft.y2 - perpY * 2,
        x2: rightWheelX,
        y2: rightWheelY,
        alpha: 0.42,
        width: 3.8,
      });
    } else {
      this.skidMarks.push({
        x1: leftWheelX,
        y1: leftWheelY,
        x2: leftWheelX,
        y2: leftWheelY,
        alpha: 0.42,
        width: 3.8,
      });
      this.skidMarks.push({
        x1: rightWheelX,
        y1: rightWheelY,
        x2: rightWheelX,
        y2: rightWheelY,
        alpha: 0.42,
        width: 3.8,
      });
    }
  }

  // Update Human Character on foot
  public updatePlayerCharacter(
    player: PlayerCharacter,
    inputs: {
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      sprint: boolean;
    },
    delta: number,
    buildings: Building[]
  ) {
    let dx = 0;
    let dy = 0;
    if (inputs.up) dy -= 1;
    if (inputs.down) dy += 1;
    if (inputs.left) dx -= 1;
    if (inputs.right) dx += 1;

    const isMoving = dx !== 0 || dy !== 0;
    if (isMoving) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;

      player.angle = Math.atan2(dy, dx);
      const baseSpeed = inputs.sprint ? 5.5 : 3.2;
      player.speed = baseSpeed;
      player.isRunning = inputs.sprint;

      const nextX = player.x + dx * player.speed * 60 * delta;
      const nextY = player.y + dy * player.speed * 60 * delta;

      // Check collision with buildings
      let collides = false;
      for (const b of buildings) {
        if (
          nextX >= b.x - b.width / 2 - 10 &&
          nextX <= b.x + b.width / 2 + 10 &&
          nextY >= b.y - b.height / 2 - 10 &&
          nextY <= b.y + b.height / 2 + 10
        ) {
          collides = true;
          break;
        }
      }

      if (!collides) {
        player.x = Math.max(80, Math.min(WORLD_SIZE - 80, nextX));
        player.y = Math.max(80, Math.min(WORLD_SIZE - 80, nextY));
      }
    } else {
      player.speed = 0;
      player.isRunning = false;
    }
  }

  // Resolve Collisions: Vehicles vs Vehicles, Props, Buildings, and Pedestrians
  public resolveAllCollisions(
    vehicles: VehicleInstance[],
    destructibles: DestructibleObject[],
    pedestrians: Pedestrian[],
    buildings: Building[],
    onPropDestroyed?: (propId: string) => void,
    delta: number = 0.016,
    onVehicleCrash?: VehicleCrashHandler
  ) {
    const now = performance.now();

    // 1. Vehicle vs Vehicle Collisions (Smooth Pushing & Mass Momentum Exchange)
    for (let i = 0; i < vehicles.length; i++) {
      const v1 = vehicles[i];
      const cfg1 = VEHICLE_CONFIGS[v1.type] || VEHICLE_CONFIGS.sedan;

      for (let j = i + 1; j < vehicles.length; j++) {
        const v2 = vehicles[j];
        const cfg2 = VEHICLE_CONFIGS[v2.type] || VEHICLE_CONFIGS.sedan;

        // NPC traffic is coordinated by TrafficAI (lights, following distance
        // and lane keeping). Applying the player collision response to every
        // NPC pair made crossing traffic exchange momentum, reverse direction
        // and accumulate damage until an entire junction locked up. Let the
        // AI resolve NPC-to-NPC spacing and keep physics collisions for the
        // player, where impact feedback is meaningful.
        if (!v1.isPlayer && !v2.isPlayer) continue;

        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = (cfg1.length + cfg2.length) * 0.38;

        if (dist < minDist && dist > 0.001) {
          // Push apart based on mass ratio
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          const totalMass = cfg1.mass + cfg2.mass;

          // Heavier vehicle barely moves; lighter vehicle yields and moves away
          const ratio1 = cfg2.mass / totalMass; // v1 displacement ratio
          const ratio2 = cfg1.mass / totalMass; // v2 displacement ratio

          v1.x -= nx * overlap * ratio1;
          v1.y -= ny * overlap * ratio1;
          v2.x += nx * overlap * ratio2;
          v2.y += ny * overlap * ratio2;

          // Compute velocities in Cartesian plane
          const vx1 = Math.cos(v1.angle) * v1.speed;
          const vy1 = Math.sin(v1.angle) * v1.speed;
          const vx2 = Math.cos(v2.angle) * v2.speed;
          const vy2 = Math.sin(v2.angle) * v2.speed;

          // Closing speed along the collision normal
          const normalClosingSpeed = (vx1 - vx2) * nx + (vy1 - vy2) * ny;
          const relSpeed = Math.hypot(vx1 - vx2, vy1 - vy2);

          // A) High-Speed HARD Impact (Sparks, Sound, Damage)
          if (relSpeed > 5.5 && normalClosingSpeed > 2.5) {
            const pairKey = v1.id < v2.id ? `${v1.id}_${v2.id}` : `${v2.id}_${v1.id}`;
            // performance.now() is near zero when the app starts. A first
            // collision must still be able to trigger damage immediately.
            const lastHit = this.lastImpactTime.get(pairKey) ?? -Infinity;

            if (now - lastHit > 500) {
              this.lastImpactTime.set(pairKey, now);
              const impactExcess = relSpeed - 4.0;
              const dmg1 = Math.round(impactExcess * 2.2 * (cfg2.mass / totalMass));
              const dmg2 = Math.round(impactExcess * 2.2 * (cfg1.mass / totalMass));

              v1.health = Math.max(0, v1.health - dmg1);
              v2.health = Math.max(0, v2.health - dmg2);

              this.emitSparks(v1.x + nx * (dist * 0.5), v1.y + ny * (dist * 0.5), 14);
              sound.playCrash(Math.min(1.0, impactExcess / 8));

              onVehicleCrash?.(
                {
                  type: 'vehicle_vehicle',
                  impactSpeed: relSpeed,
                  x: (v1.x + v2.x) * 0.5,
                  y: (v1.y + v2.y) * 0.5,
                },
                v1,
                v2
              );
            }
          }

          // B) Gentle Touch & Smooth Heavy Pushing Mechanics
          // If v1 (e.g. Kamaz) is moving into v2:
          if (normalClosingSpeed > 0.05) {
            const pushForce = normalClosingSpeed * ratio2;

            // Push v2 smoothly in contact normal direction
            v2.x += nx * pushForce * 25 * delta;
            v2.y += ny * pushForce * 25 * delta;

            // Impart rolling speed to v2 in push direction
            const v2Dot = Math.cos(v2.angle) * nx + Math.sin(v2.angle) * ny;
            if (v2Dot > 0.2) {
              // A collision transfers only a fraction of forward momentum.
              // Copying 85% of the hitter's speed made a stopped NPC launch
              // like a projectile after a gentle contact.
              v2.speed = Math.max(v2.speed, Math.abs(v1.speed) * 0.28);
            } else if (v2Dot < -0.2) {
              v2.speed = -Math.abs(v1.speed * 0.7);
            } else {
              // Sliding sideways
              v2.x += nx * Math.abs(v1.speed) * 4 * delta;
              v2.y += ny * Math.abs(v1.speed) * 4 * delta;
              v2.angle += (nx * -Math.sin(v2.angle) + ny * Math.cos(v2.angle)) * 0.05;
            }

            // Pushing vehicle experiences minor resistance proportional to pushed vehicle mass
            const resistance = (cfg2.mass / totalMass) * 0.12;
            v1.speed *= Math.max(0.7, 1 - resistance * delta * 4);
          } else if (normalClosingSpeed < -0.05) {
            // v2 is moving into v1
            const pushForce = -normalClosingSpeed * ratio1;
            v1.x -= nx * pushForce * 25 * delta;
            v1.y -= ny * pushForce * 25 * delta;

            const v1Dot = -(Math.cos(v1.angle) * nx + Math.sin(v1.angle) * ny);
            if (v1Dot > 0.2) {
              v1.speed = Math.max(v1.speed, Math.abs(v2.speed) * 0.28);
            }
          }

          // The crash state owns the vehicle until the roadside recovery
          // timer expires; collision response must not relaunch a wreck.
          if (v1.isCrashed) v1.speed = 0;
          if (v2.isCrashed) v2.speed = 0;
        }
      }

      // 2. Vehicle vs Buildings (Solid bounding walls)
      for (const b of buildings) {
        const halfW = b.width / 2 + cfg1.width * 0.45;
        const halfH = b.height / 2 + cfg1.length * 0.35;

        if (
          Math.abs(v1.x - b.x) < halfW &&
          Math.abs(v1.y - b.y) < halfH
        ) {
          const overlapX = halfW - Math.abs(v1.x - b.x);
          const overlapY = halfH - Math.abs(v1.y - b.y);

          if (overlapX < overlapY) {
            v1.x += (v1.x > b.x ? 1 : -1) * overlapX;
          } else {
            v1.y += (v1.y > b.y ? 1 : -1) * overlapY;
          }

          const impactSpeed = Math.abs(v1.speed);
          if (impactSpeed > 3.0) {
            const bKey = `b_${v1.id}_${b.id}`;
            const lastBHit = this.lastImpactTime.get(bKey) ?? -Infinity;
            if (now - lastBHit > 450) {
              this.lastImpactTime.set(bKey, now);
              const dmg = Math.round((impactSpeed - 2.0) * 3.5);
              v1.health = Math.max(0, v1.health - dmg);
              this.emitSparks(v1.x, v1.y, 14);
              sound.playCrash(Math.min(1.0, impactSpeed / 7));
            }
          }
          v1.speed = -v1.speed * 0.2;
        }
      }

      // 3. Vehicle vs Destructibles (Crates, cones, lamps, hydrants, fences, barrels)
      for (const prop of destructibles) {
        if (prop.isDestroyed) continue;

        const pdx = prop.x - v1.x;
        const pdy = prop.y - v1.y;
        const pDist = Math.hypot(pdx, pdy);
        const hitDist = (cfg1.length * 0.42) + prop.width * 0.75;

        if (pDist < hitDist) {
          const hitSpeed = Math.abs(v1.speed);

          // KAMAZ delivers massive crushing force
          const isHeavy = cfg1.mass > 3000;
          const damage = Math.round((hitSpeed * 12 + (isHeavy ? 70 : 25)));

          prop.health -= damage;

          if (prop.health <= 0) {
            prop.isDestroyed = true;
            onPropDestroyed?.(prop.id);

            if (prop.type === 'crate' || prop.type === 'fence') {
              this.emitWoodSplinters(prop.x, prop.y, 28);
              sound.playCrateBreak();
            } else if (prop.type === 'hydrant') {
              this.emitWaterFountain(prop.x, prop.y);
              sound.playHydrantSplash();
            } else if (prop.type === 'lamp_pole') {
              this.emitSparks(prop.x, prop.y, 35);
              sound.playCrash(0.8);
            } else if (prop.type === 'barrel') {
              this.emitDamageSmoke({ ...v1, x: prop.x, y: prop.y }, true);
              this.emitDebris(prop.x, prop.y, '#0284c7', 20);
              sound.playCrash(0.9);
            } else if (prop.type === 'cone' || prop.type === 'trash_can') {
              this.emitDebris(prop.x, prop.y, '#f97316', 15);
              sound.playCrateBreak();
            }
          }

          // Vehicle reaction to prop
          if (prop.type === 'lamp_pole' && !isHeavy) {
            v1.speed *= 0.4;
            v1.health = Math.max(0, v1.health - 8);
          } else {
            v1.speed *= 0.94;
          }
        }
      }

      // 4. Vehicle vs Pedestrians ("человечки")
      for (const ped of pedestrians) {
        const pedDx = ped.x - v1.x;
        const pedDy = ped.y - v1.y;
        const pedDist = Math.hypot(pedDx, pedDy);

        if (pedDist < cfg1.length * 0.45 && Math.abs(v1.speed) > 1.0) {
          // Knockback Pedestrian into Ragdoll
          ped.state = 'ragdoll';
          ped.ragdollTimer = 3.5;
          const angle = Math.atan2(pedDy, pedDx);
          const pushForce = Math.min(20, Math.abs(v1.speed) * 1.8);
          ped.vx = Math.cos(angle) * pushForce;
          ped.vy = Math.sin(angle) * pushForce;

          ped.speechText = ['Ай!', 'Осторожно!', 'Куда летишь?!', 'Смотри на дорогу!', 'Вот это КАМАЗ!'][
            Math.floor(Math.random() * 5)
          ];
          ped.speechTimer = 2.8;

          this.emitDebris(ped.x, ped.y, ped.shirtColor, 8);
          sound.playCrash(0.35);
        }
      }
    }
  }

  // Update Particles (Decay, motion)
  public updateParticles(delta: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * 60 * delta;
      p.y += p.vy * 60 * delta;
      p.alpha -= p.decay * delta;
      p.size *= (1 + 0.35 * delta); // expansion

      if (p.alpha <= 0 || p.size <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  // Particle Emitters
  public emitDamageSmoke(vehicle: VehicleInstance, isFire: boolean) {
    const angle = vehicle.angle + Math.PI + (Math.random() * 0.4 - 0.2);
    const offset = (VEHICLE_CONFIGS[vehicle.type]?.length || 45) * 0.32;
    const px = vehicle.x + Math.cos(angle) * offset;
    const py = vehicle.y + Math.sin(angle) * offset;

    this.particles.push({
      id: `part_${Math.random()}`,
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 1.8,
      vy: (Math.random() - 0.5) * 1.8 - 1.4,
      size: 4 + Math.random() * 5,
      color: isFire ? (Math.random() > 0.4 ? '#f97316' : '#ef4444') : '#475569',
      alpha: 0.85,
      decay: 1.1,
      type: isFire ? 'fire' : 'smoke',
    });
  }

  public emitSparks(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 5.5;
      this.particles.push({
        id: `spark_${Math.random()}`,
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 2 + Math.random() * 2.5,
        color: Math.random() > 0.3 ? '#fef08a' : '#f97316',
        alpha: 1.0,
        decay: 3.2,
        type: 'spark',
      });
    }
  }

  public emitWoodSplinters(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 6.5;
      this.particles.push({
        id: `splinter_${Math.random()}`,
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3 + Math.random() * 4.5,
        color: '#b45309',
        alpha: 1.0,
        decay: 1.4,
        type: 'splinter',
        angle: Math.random() * Math.PI,
      });
    }
  }

  public emitWaterFountain(x: number, y: number) {
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.2 + Math.random() * 4.5;
      this.particles.push({
        id: `water_${Math.random()}`,
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 4.0,
        size: 3 + Math.random() * 5,
        color: '#38bdf8',
        alpha: 0.95,
        decay: 1.6,
        type: 'water',
      });
    }
  }

  public emitDebris(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.8 + Math.random() * 4.5;
      this.particles.push({
        id: `deb_${Math.random()}`,
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 2 + Math.random() * 3.5,
        color,
        alpha: 0.9,
        decay: 1.8,
        type: 'dust',
      });
    }
  }
}
