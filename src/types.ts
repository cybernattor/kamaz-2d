export type VehicleCategory =
  | 'kamaz_dump'
  | 'kamaz_flatbed'
  | 'heavy_4x4'
  | 'ambulance'
  | 'police'
  | 'sedan'
  | 'hatchback'
  | 'sports'
  | 'bus'
  | 'taxi';

export interface VehicleConfig {
  id: VehicleCategory;
  name: string;
  nameRu: string;
  width: number;
  length: number;
  mass: number;
  maxSpeed: number; // km/h
  acceleration: number;
  braking: number;
  turnSpeed: number;
  reverseSpeed: number;
  driftFriction: number;
  durability: number;
  defaultColor: string;
  hasSiren?: boolean;
  cargoCapacity?: number;
  description: string;
}

export interface VehicleInstance {
  id: string;
  type: VehicleCategory;
  x: number;
  y: number;
  angle: number; // in radians
  speed: number; // current speed
  steeringAngle: number; // front wheel angle
  angularVelocity: number;
  color: string;
  health: number; // 0-100
  maxHealth: number;
  headlights: number; // 0=off, 1=low, 2=high
  turnSignal: 'none' | 'left' | 'right' | 'hazard';
  isBraking: boolean;
  isReversing: boolean;
  isHonking: boolean;
  isSiren: boolean;
  isPlayer: boolean;
  isRemotePlayer?: boolean;
  playerName?: string;
  cargo?: {
    type: string;
    name: string;
    amount: number;
    maxAmount: number;
    color: string;
  };
  smokeTimer: number;
  /** Set when an NPC is involved in a serious impact and remains roadside. */
  isCrashed?: boolean;
  crashTimer?: number;
  crashSpeech?: string;
  crashSpeechTimer?: number;
}

export interface Pedestrian {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  targetX: number;
  targetY: number;
  state: 'walking' | 'waiting' | 'fleeing' | 'ragdoll' | 'talking';
  health: number;
  skinColor: string;
  shirtColor: string;
  pantsColor: string;
  speechText?: string;
  speechTimer: number;
  ragdollTimer: number;
  vx: number;
  vy: number;
  isDriver?: boolean;
  vehicleId?: string;
  vehicleHitCooldown?: number;
}

export type DestructibleType =
  | 'crate'
  | 'cone'
  | 'barrel'
  | 'lamp_pole'
  | 'hydrant'
  | 'fence'
  | 'trash_can'
  | 'barrier';

export interface DestructibleObject {
  id: string;
  type: DestructibleType;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  isDestroyed: boolean;
  respawnTime: number;
  vx?: number;
  vy?: number;
  va?: number;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  type: 'smoke' | 'fire' | 'spark' | 'water' | 'splinter' | 'dust' | 'skid';
  angle?: number;
}

export interface SkidMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
  width: number;
}

export interface TrafficLight {
  id: string;
  x: number;
  y: number;
  intersectionId: string;
  direction: 'north' | 'south' | 'east' | 'west';
  state: 'green' | 'yellow' | 'red';
  pedestrianState: 'walk' | 'dont_walk';
}

export type MapDecorationType = 'water' | 'park' | 'forest' | 'plaza' | 'industrial';

export interface MapDecoration {
  id: string;
  type: MapDecorationType;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface MapTrail {
  id: string;
  label: string;
  points: Array<{ x: number; y: number }>;
}

export interface PointOfInterest {
  id: string;
  name: string;
  nameRu: string;
  type: 'depot' | 'construction' | 'port' | 'quarry' | 'hospital' | 'police' | 'workshop' | 'gas_station' | 'warehouse';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  icon: string;
  description: string;
}

export interface Mission {
  id: string;
  title: string;
  titleRu: string;
  category: 'delivery' | 'emergency' | 'construction' | 'fragile' | 'taxi' | 'patrol' | 'demolition';
  description: string;
  descriptionRu: string;
  sourcePoiId: string;
  targetPoiId: string;
  rewardMoney: number;
  rewardXp: number;
  requiredVehicleType?: VehicleCategory;
  cargoName?: string;
  cargoAmount?: number;
  timeLimitSeconds?: number;
  currentSeconds?: number;
  status: 'available' | 'active' | 'completed' | 'failed';
}

export interface PlayerCharacter {
  x: number;
  y: number;
  angle: number;
  speed: number;
  health: number;
  maxHealth: number;
  inVehicleId: string | null;
  isRunning: boolean;
  name: string;
  money: number;
  xp: number;
  level: number;
  inventory: {
    repairKits: number;
    fuelCans: number;
  };
}

export interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  steering: number;
  inVehicle: boolean;
  vehicleType: VehicleCategory;
  vehicleColor: string;
  condition: number;
  headlights: number;
  turnSignal: string;
  isHonking: boolean;
  isSiren: boolean;
  speechText?: string;
  speechTime?: number;
  lastUpdate: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  timestamp: number;
}
