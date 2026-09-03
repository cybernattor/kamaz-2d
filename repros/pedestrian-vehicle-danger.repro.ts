import { CityMap } from '../src/game/cityMap';
import { TrafficAI } from '../src/game/trafficAI';
import { VehicleInstance } from '../src/types';

const DELTA = 1 / 60;

/**
 * Pedestrians only fled a horn or, rarely, sheer proximity to the player -
 * a silent NPC (or a silent player) bearing straight down on one at speed
 * went completely unnoticed until contact. Real pedestrians react to a near
 * miss whether or not anyone honked.
 */
function main() {
  const traffic = new TrafficAI(new CityMap());
  const pedestrian = traffic.pedestrians[0];
  if (!pedestrian) throw new Error('Danger fixture was not created');
  for (const other of traffic.pedestrians) {
    if (other !== pedestrian) other.x = other.y = -10000;
  }
  for (const npc of traffic.npcVehicles) npc.health = 0;

  pedestrian.x = 1040;
  pedestrian.y = 1000;
  pedestrian.targetX = 1040;
  pedestrian.targetY = 1000;

  const oncoming: VehicleInstance = {
    id: 'danger-fixture',
    type: 'sedan',
    x: 600,
    y: 1000,
    angle: 0, // driving straight at the pedestrian (+x)
    speed: 18,
    steeringAngle: 0,
    angularVelocity: 0,
    color: '#fff',
    health: 100,
    maxHealth: 100,
    headlights: 0,
    turnSignal: 'none',
    isBraking: false,
    isReversing: false,
    isHonking: false,
    isSiren: false,
    isPlayer: false,
    smokeTimer: 0,
  };
  traffic.npcVehicles.push(oncoming);

  // Player is far away and silent - only the oncoming NPC is a threat.
  traffic.updatePedestrians(DELTA, -5000, -5000, false);

  if (pedestrian.state !== 'fleeing') {
    throw new Error(`pedestrian ignored a silent vehicle closing in at speed: state is "${pedestrian.state}"`);
  }
  if (pedestrian.panicTargetX === undefined || pedestrian.panicTargetY === undefined) {
    throw new Error('pedestrian entered fleeing state without picking an escape target');
  }

  // A vehicle passing in the same direction but with a clear lateral gap
  // must not cause the GTA-style danger reaction.
  pedestrian.state = 'walking';
  pedestrian.panicTimer = 0;
  pedestrian.panicCooldown = 0;
  pedestrian.speechText = undefined;
  pedestrian.x = 1040;
  pedestrian.y = 1000;
  oncoming.x = 600;
  oncoming.y = 1060;
  traffic.updatePedestrians(DELTA, -5000, -5000, false);
  if (String(pedestrian.state) === 'fleeing') {
    throw new Error('Pedestrian fled from a vehicle that would safely pass alongside the sidewalk');
  }

  console.log('FIXED: pedestrians flee a predicted fast collision, but ignore a safe passing vehicle.');
}

main();
