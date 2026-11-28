import { CityMap, CROSSWALK_DEPTH } from '../src/game/cityMap';
import { locateOnGradeStructure } from '../src/game/gradeSeparation';
import { TrafficAI } from '../src/game/trafficAI';

const DELTA = 1 / 60;
/** How far past the kerb (into the drivable surface) a pedestrian may stray. */
const KERB_TOLERANCE = 30;
/** Slack around the zebra band at each junction edge. */
const CROSSWALK_TOLERANCE = 10;

function main() {
  const cityMap = new CityMap();
  const traffic = new TrafficAI(cityMap);
  for (let frame = 0; frame < 900; frame += 1) {
    traffic.updatePedestrians(DELTA, 120, 120, false);
  }

  // Pedestrians cross at signalled junctions on the zebra band just outside
  // each intersection box (see beginPedestrianCrosswalk), so being on the
  // drivable surface is only allowed there - never mid-block or inside the
  // junction itself.
  const onCrosswalk = (x: number, y: number) =>
    cityMap.intersections.some((inter) => {
      const beyondBoxEdge = Math.max(Math.abs(x - inter.x), Math.abs(y - inter.y)) - inter.size / 2;
      return beyondBoxEdge >= -CROSSWALK_TOLERANCE && beyondBoxEdge <= CROSSWALK_DEPTH + CROSSWALK_TOLERANCE;
    });

  let closestOffCrosswalk = Infinity;
  let crossing = 0;
  for (const ped of traffic.pedestrians) {
    // Clearance to the real road polylines (negative = on the drivable surface).
    // Walkers are at ground level: under the covered part of a bridge (or
    // over a tunnel) that road is on another level, not under their feet.
    const point = { x: ped.x, y: ped.y, width: 0, height: 0 };
    const covered = locateOnGradeStructure(cityMap.gradeStructures, ped.x, ped.y);
    const otherLevel = covered && covered.lift >= 1 ? covered.structure.roadId : null;
    const clearance = cityMap.roads
      .filter((road) => road.id !== otherLevel)
      .reduce((best, road) => Math.min(best, cityMap.clearanceToRoad(point, road)), Infinity);
    if (clearance < -KERB_TOLERANCE && onCrosswalk(ped.x, ped.y)) {
      crossing += 1;
      continue;
    }
    closestOffCrosswalk = Math.min(closestOffCrosswalk, clearance);
  }

  if (closestOffCrosswalk < -KERB_TOLERANCE) {
    throw new Error(`Pedestrian entered the roadway off a crosswalk: ${(-closestOffCrosswalk).toFixed(1)}px onto the drivable surface`);
  }

  console.log(
    `FIXED: pedestrians stayed on sidewalks or crosswalks; closest kerb clearance ${closestOffCrosswalk.toFixed(1)}, ` +
      `${crossing} on a crosswalk.`
  );
}

main();
