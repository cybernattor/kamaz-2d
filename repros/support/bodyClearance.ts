import { VEHICLE_CONFIGS } from '../../src/game/vehicleConfigs';
import { VehicleInstance } from '../../src/types';

type Body = Pick<VehicleInstance, 'x' | 'y' | 'angle' | 'type'>;

function corners(body: Body) {
  const config = VEHICLE_CONFIGS[body.type] || VEHICLE_CONFIGS.sedan;
  const fx = Math.cos(body.angle);
  const fy = Math.sin(body.angle);
  const hl = config.length / 2;
  const hw = config.width / 2;
  return [
    [hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw],
  ].map(([a, b]) => ({ x: body.x + fx * a - fy * b, y: body.y + fy * a + fx * b }));
}

/**
 * Separation between two vehicle bodies as oriented rectangles (separating
 * axis test): positive is the gap along the best separating axis, negative
 * means the bodies overlap. Centre-to-centre distance is not a substitute:
 * two cars side by side have close centres without touching.
 */
export function bodyClearance(first: Body, second: Body) {
  const a = corners(first);
  const b = corners(second);
  let best = -Infinity;
  for (const body of [first, second]) {
    for (const axis of [
      { x: Math.cos(body.angle), y: Math.sin(body.angle) },
      { x: -Math.sin(body.angle), y: Math.cos(body.angle) },
    ]) {
      const project = (points: Array<{ x: number; y: number }>) => points.map((p) => p.x * axis.x + p.y * axis.y);
      const pa = project(a);
      const pb = project(b);
      const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
      best = Math.max(best, gap);
    }
  }
  return best;
}
