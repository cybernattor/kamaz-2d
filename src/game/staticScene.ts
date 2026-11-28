import { PointOfInterest, MapDecoration, MapTrail } from '../types';
import { Building, CityDistrict, CityMap, CROSSWALK_DEPTH, RoadSegment, WORLD_SIZE } from './cityMap';
import { GRADE_HEIGHT, GRADE_RAIL_OFFSET, GRADE_RAMP, gradeLift, GradeSample, GradeStructure } from './gradeSeparation';

type Point = { x: number; y: number };

const distanceToPolyline = (point: Point, line: Point[]) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
  }
  return best;
};

export interface GradeOverlay {
  kind: 'bridge' | 'tunnel';
  structure: GradeStructure;
  canvas: HTMLCanvasElement;
  /** World-space rect the canvas covers. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bakes the static city (ground, districts, roads, intersections, POIs,
 * buildings) into one offscreen canvas. PixiGameRenderer uploads it as a
 * single texture and FullMapModal blits it, so the thousands of static shapes
 * are rasterised once instead of every frame. Everything dynamic (vehicles,
 * pedestrians, effects, labels) lives in PixiGameRenderer.
 */
export class StaticSceneBaker {
  private scene: HTMLCanvasElement | null = null;
  private sceneMap: CityMap | null = null;
  private sceneOverview = false;
  private scale = 1;
  /** Mouths cut out of each road's edge lines, by road id (see findRoadMouths). */
  private mouths = new Map<string, Point[][]>();
  /** Driveways drawn on to their POI yard (see findDrivewayExtensions). */
  private drivewayPoints = new WeakMap<RoadSegment, Point[]>();
  /** Tunnel roofs cut from the scene before the interiors were painted into it. */
  private tunnelRoofs: GradeOverlay[] | null = null;

  /**
   * Whether bridge decks and tunnel roofs are part of the baked scene. The
   * game renderer turns this off: each deck is drawn only in its own overlay,
   * and each covered tunnel stretch is baked as the inside of the tunnel with
   * its roof cut out into an overlay first. So when a deck or roof fades to
   * see-through over the player, what shows is the level below and its
   * traffic, not a second copy of what was on top.
   */
  public bakeBridges = true;

  public setScale(scale: number) {
    const next = Math.max(0.25, scale);
    if (next === this.scale) return;
    this.scale = next;
    this.scene = null;
    this.sceneMap = null;
  }

  public getScale() {
    return this.scale;
  }

  public getStaticScene(cityMap: CityMap, overview = false) {
    this.ensure(cityMap, overview);
    return this.scene;
  }

  private ensure(cityMap: CityMap, overview: boolean) {
    if (this.sceneMap === cityMap && this.scene && this.sceneOverview === overview) return;

    const scale = this.scale;
    const scene = document.createElement('canvas');
    scene.width = Math.ceil(WORLD_SIZE * scale);
    scene.height = Math.ceil(WORLD_SIZE * scale);
    const ctx = scene.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    this.renderGround(ctx);
    this.renderDistricts(ctx, cityMap.districts);
    this.renderMapDecorations(ctx, cityMap.decorations);
    this.renderScenicRoutes(ctx, cityMap.scenicRoutes);
    this.renderRoads(ctx, cityMap, overview);
    this.renderIntersections(ctx, cityMap, overview);
    if (this.bakeBridges) this.renderBridges(ctx, cityMap, overview);
    this.renderPOIs(ctx, cityMap.pois, null);
    this.renderBuildings(ctx, cityMap.buildings);

    this.tunnelRoofs = null;
    if (!this.bakeBridges) {
      this.tunnelRoofs = cityMap.gradeStructures
        .filter((structure) => structure.kind === 'tunnel')
        .map((structure) => this.cropTunnelRoof(scene, structure))
        .filter((overlay): overlay is GradeOverlay => overlay !== null);
      this.renderTunnelInteriors(ctx, cityMap, overview);
    }

    this.scene = scene;
    this.sceneMap = cityMap;
    this.sceneOverview = overview;
  }

  /** The whole world is baked, so every shape is "visible". */
  private isVisible(x: number, y: number, width: number, height: number) {
    return x + width / 2 >= 0 && x - width / 2 <= WORLD_SIZE
      && y + height / 2 >= 0 && y - height / 2 <= WORLD_SIZE;
  }

  private renderGround(ctx: CanvasRenderingContext2D) {
    // City green base
    ctx.fillStyle = '#0f3822'; // Lush grass tone
    ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Decorative suburban grass grid
    ctx.strokeStyle = '#14462b';
    ctx.lineWidth = 2;
    for (let x = 0; x < WORLD_SIZE; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y < WORLD_SIZE; y += 120) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_SIZE, y);
      ctx.stroke();
    }
  }

  /**
   * Districts tint the ground so the city and the outskirts read differently
   * while driving. The overview map already drew them; the world did not, even
   * though the render order was written as if it did.
   */
  private renderDistricts(ctx: CanvasRenderingContext2D, districts: CityDistrict[]) {
    districts.forEach((district) => {
      const left = district.x - district.width / 2;
      const top = district.y - district.height / 2;

      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = district.color;
      ctx.fillRect(left, top, district.width, district.height);
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = district.accent;
      ctx.lineWidth = 6;
      ctx.strokeRect(left, top, district.width, district.height);
      ctx.restore();
    });
  }

  private renderMapDecorations(ctx: CanvasRenderingContext2D, decorations: MapDecoration[]) {
    decorations.forEach((zone) => {
      if (!this.isVisible(zone.x, zone.y, zone.width, zone.height)) return;
      const left = zone.x - zone.width / 2;
      const top = zone.y - zone.height / 2;
      const right = zone.x + zone.width / 2;
      const bottom = zone.y + zone.height / 2;

      ctx.save();
      ctx.fillStyle = zone.type === 'water'
        ? '#075985'
        : zone.type === 'industrial'
        ? '#3f3f46'
        : zone.type === 'plaza'
        ? '#475569'
        : zone.type === 'desert'
        ? '#713f12'
        : zone.type === 'hills'
        ? '#365314'
        : zone.type === 'rail'
        ? '#1e293b'
        : zone.type === 'airport'
        ? '#334155'
        : zone.type === 'beach'
        ? '#a16207'
        : '#166534';
      ctx.fillRect(left, top, zone.width, zone.height);

      ctx.strokeStyle = zone.type === 'water' || zone.type === 'rail' || zone.type === 'airport' ? '#38bdf8' : zone.type === 'desert' ? '#f59e0b' : '#4ade80';
      ctx.lineWidth = 3;
      ctx.strokeRect(left + 3, top + 3, zone.width - 6, zone.height - 6);

      if (zone.type === 'water') {
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
        ctx.lineWidth = 2;
        for (let y = top + 28; y < bottom - 12; y += 34) {
          ctx.beginPath();
          ctx.moveTo(left + 20, y);
          ctx.quadraticCurveTo(zone.x - 18, y - 8, zone.x + 8, y);
          ctx.quadraticCurveTo(zone.x + 36, y + 8, right - 20, y);
          ctx.stroke();
        }
      } else if (zone.type === 'park' || zone.type === 'forest') {
        const columns = Math.max(3, Math.floor(zone.width / 72));
        const rows = Math.max(3, Math.floor(zone.height / 72));
        for (let column = 0; column < columns; column += 1) {
          for (let row = 0; row < rows; row += 1) {
            const treeX = left + 32 + column * 68 + (row % 2) * 12;
            const treeY = top + 34 + row * 64;
            if (treeX > right - 22 || treeY > bottom - 22) continue;
            ctx.fillStyle = zone.type === 'forest' ? '#14532d' : '#15803d';
            ctx.beginPath();
            ctx.arc(treeX, treeY, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#854d0e';
            ctx.fillRect(treeX - 2, treeY + 10, 4, 9);
          }
        }
        ctx.strokeStyle = '#d9f99d';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(left + 16, zone.y);
        ctx.lineTo(right - 16, zone.y);
        ctx.stroke();
      } else if (zone.type === 'plaza') {
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
        ctx.lineWidth = 1;
        for (let x = left + 20; x < right; x += 34) {
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
        }
        for (let y = top + 20; y < bottom; y += 34) {
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#bae6fd';
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (zone.type === 'industrial') {
        ctx.fillStyle = '#64748b';
        for (let x = left + 24; x < right - 30; x += 82) {
          ctx.fillRect(x, top + 34, 52, 28);
          ctx.fillRect(x + 12, top + 92, 40, 24);
        }
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.setLineDash([14, 10]);
        ctx.beginPath();
        ctx.moveTo(left + 16, bottom - 38);
        ctx.lineTo(right - 16, bottom - 38);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (zone.type === 'desert' || zone.type === 'hills') {
        ctx.fillStyle = zone.type === 'desert' ? 'rgba(251, 191, 36, 0.28)' : 'rgba(134, 239, 172, 0.18)';
        for (let i = 0; i < 9; i += 1) {
          const hillX = left + 50 + ((i * 137) % Math.max(80, zone.width - 80));
          const hillY = top + 40 + ((i * 83) % Math.max(80, zone.height - 80));
          ctx.beginPath();
          ctx.arc(hillX, hillY, zone.type === 'desert' ? 20 + (i % 3) * 8 : 34 + (i % 2) * 12, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (zone.type === 'rail') {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        for (let y = top + 18; y < bottom; y += 26) {
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(left, top + 20);
        ctx.lineTo(right, top + 20);
        ctx.moveTo(left, bottom - 20);
        ctx.lineTo(right, bottom - 20);
        ctx.stroke();
      } else if (zone.type === 'airport') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(left + 20, zone.y - 9, zone.width - 40, 18);
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 3;
        ctx.setLineDash([24, 18]);
        ctx.beginPath();
        ctx.moveTo(left + 35, zone.y);
        ctx.lineTo(right - 35, zone.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
      ctx.font = 'bold 11px "JetBrains Mono", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(zone.label, zone.x, bottom - 10);
      ctx.restore();
    });
  }

  private renderScenicRoutes(ctx: CanvasRenderingContext2D, routes: MapTrail[]) {
    routes.forEach((route) => {
      if (route.points.length < 2) return;
      const routeCenter = route.points[Math.floor(route.points.length / 2)];
      if (!this.isVisible(routeCenter.x, routeCenter.y, 420, 420)) return;
      ctx.save();
      const isParkPath = route.id === 'trail-park-loop';
      ctx.strokeStyle = isParkPath ? '#78716c' : '#a16207';
      ctx.lineWidth = isParkPath ? 12 : 24;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(route.points[0].x, route.points[0].y);
      route.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.strokeStyle = isParkPath ? '#ecfccb' : '#d6b37a';
      ctx.lineWidth = isParkPath ? 4 : 10;
      ctx.setLineDash(isParkPath ? [8, 10] : [18, 16]);
      ctx.beginPath();
      ctx.moveTo(route.points[0].x, route.points[0].y);
      route.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(254, 243, 199, 0.78)';
      ctx.font = 'bold 12px "JetBrains Mono", sans-serif';
      const labelPoint = route.points[Math.floor(route.points.length / 2)];
      ctx.fillText(route.label, labelPoint.x + 12, labelPoint.y - 14);
      ctx.restore();
    });
  }

  /**
   * Paint layer of a road. Each layer lays its asphalt and then its markings
   * before the next layer starts, so a wider road's carriageway wipes the
   * centerlines of every narrower road that ends on it or crosses it. Before,
   * all asphalt went down first and all markings after, which painted the
   * yellow centerline of every access road straight across the arterials.
   */
  private roadLayer(road: RoadSegment) {
    if (road.feature === 'tunnel') return 0;
    // A bridge road is laid at ground level like any arterial (its ends meet
    // junctions at grade); only the elevated deck is redrawn on top later.
    return road.width >= 200 ? 2 : 1;
  }

  /**
   * Strokes a road's centerline shifted sideways by `offset`. Vertices are
   * pushed out along the miter so parallel lines keep their spacing through
   * a bend; offsetting along the averaged tangent alone pinched every lane
   * line together at sharp corners.
   */
  private strokeRoadLine(ctx: CanvasRenderingContext2D, road: RoadSegment, width: number, offset = 0) {
    const points = this.roadPoints(road);
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((point, index) => {
      const shifted = this.offsetVertex(points, index, offset);
      if (index === 0) ctx.moveTo(shifted.x, shifted.y); else ctx.lineTo(shifted.x, shifted.y);
    });
    ctx.stroke();
  }

  /**
   * A driveway's map endpoint stops a verge short of its POI yard (left over
   * from when narrow roads had round caps that would have bulged into it),
   * so drawn as-is every driveway ended on a strip of grass. The pavement is
   * carried on to the yard's edge; the yard is drawn later, over the seam.
   */
  private findDrivewayExtensions(cityMap: CityMap) {
    const extended = new WeakMap<RoadSegment, Point[]>();
    /** Where the pavement leaving `end` (heading away from `from`) meets a yard within reach. */
    const reachYard = (end: Point, from: Point) => {
      const length = Math.hypot(end.x - from.x, end.y - from.y);
      if (length < 1) return null;
      const dx = (end.x - from.x) / length;
      const dy = (end.y - from.y) / length;
      let best: number | null = null;
      for (const poi of cityMap.pois) {
        // Distance along (dx, dy) from the end to where it enters the yard.
        let enter = 0;
        let leave = Infinity;
        let misses = false;
        for (const [p, d, lo, hi] of [
          [end.x, dx, poi.x - poi.width / 2, poi.x + poi.width / 2],
          [end.y, dy, poi.y - poi.height / 2, poi.y + poi.height / 2],
        ]) {
          if (Math.abs(d) < 1e-6) {
            misses ||= p < lo || p > hi;
            continue;
          }
          const a = (lo - p) / d;
          const b = (hi - p) / d;
          enter = Math.max(enter, Math.min(a, b));
          leave = Math.min(leave, Math.max(a, b));
        }
        if (!misses && enter > 0 && enter <= leave && enter < 90 && (best === null || enter < best)) best = enter;
      }
      return best === null ? null : { x: end.x + dx * (best + 2), y: end.y + dy * (best + 2) };
    };
    // An end on another road's carriageway is a junction, not a POI end: the
    // gas station's driveway runs across the boulevard to its far curb, right
    // below the construction site's yard, and must stop there.
    const onAnotherRoad = (point: Point, road: RoadSegment) => cityMap.roads.some((other) =>
      other !== road && distanceToPolyline(point, other.points) <= other.width / 2 + 6);
    cityMap.roads.forEach((road) => {
      if (road.width >= 200 || road.points.length < 2) return;
      const points = [...road.points];
      const last = points.length - 1;
      const start = onAnotherRoad(points[0], road) ? null : reachYard(points[0], points[1]);
      const end = onAnotherRoad(points[last], road) ? null : reachYard(points[last], points[last - 1]);
      if (!start && !end) return;
      if (start) points[0] = start;
      if (end) points[last] = end;
      extended.set(road, points);
    });
    return extended;
  }

  private roadPoints(road: RoadSegment) {
    const drawn = this.drivewayPoints.get(road);
    if (drawn) return drawn;
    const points = road.points.length > 1 ? road.points : [{ x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }];
    // A road that ends close to the map edge is drawn running off the map
    // rather than ending in a turnaround bulb cut in half by the edge.
    const extend = (end: { x: number; y: number }, from: { x: number; y: number }) => {
      const edgeGap = Math.min(end.x, end.y, WORLD_SIZE - end.x, WORLD_SIZE - end.y);
      if (edgeGap > 150) return end;
      const length = Math.hypot(end.x - from.x, end.y - from.y) || 1;
      return { x: end.x + ((end.x - from.x) / length) * 400, y: end.y + ((end.y - from.y) / length) * 400 };
    };
    if (road.width < 200) return points;
    const last = points.length - 1;
    return [extend(points[0], points[1]), ...points.slice(1, last), extend(points[last], points[last - 1])];
  }

  private offsetVertex(points: { x: number; y: number }[], index: number, offset: number) {
    const point = points[index];
    if (offset === 0) return point;
    const normalOf = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    };
    // A zero-length neighbour has no direction; ignore it rather than let
    // it pull the offset vertex back toward the centerline.
    const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y) > 0.5;
    const before = index > 0 && apart(points[index - 1], point) ? normalOf(points[index - 1], point) : null;
    const after = index < points.length - 1 && apart(point, points[index + 1]) ? normalOf(point, points[index + 1]) : null;
    if (!before && !after) return point;
    const a = before ?? after!;
    const b = after ?? before!;
    let mx = a.x + b.x;
    let my = a.y + b.y;
    const length = Math.hypot(mx, my) || 1;
    mx /= length;
    my /= length;
    // 1 / cos(half the turn), capped so a near-U-turn cannot spike outward.
    const scale = 1 / Math.max(0.35, mx * a.x + my * a.y);
    return { x: point.x + mx * offset * scale, y: point.y + my * offset * scale };
  }

  private asphaltColor(road: RoadSegment) {
    return road.roadClass === 'dirt' ? '#8a6232' : road.roadClass === 'highway' ? '#222a37' : '#1e2530';
  }

  private renderRoadSurface(ctx: CanvasRenderingContext2D, road: RoadSegment) {
    ctx.setLineDash([]);
    ctx.strokeStyle = this.asphaltColor(road);
    this.strokeRoadLine(ctx, road, road.width);
    if (road.roadClass === 'dirt') {
      // Wheel ruts: two darker tracks make a dirt road read as dirt rather
      // than as an orange paved road.
      ctx.strokeStyle = 'rgba(66, 42, 17, 0.45)';
      this.strokeRoadLine(ctx, road, 7, road.width * 0.22);
      this.strokeRoadLine(ctx, road, 7, -road.width * 0.22);
    }
  }

  private renderRoadMarkings(ctx: CanvasRenderingContext2D, road: RoadSegment, cityMap: CityMap, overview: boolean) {
    // Line dash state leaks between strokes; every marking sets its own.
    if (road.roadClass === 'dirt') {
      ctx.strokeStyle = 'rgba(241, 211, 155, 0.55)';
      ctx.setLineDash([14, 12]);
      this.strokeRoadLine(ctx, road, 2);
      ctx.setLineDash([]);
      return;
    }

    const half = road.width / 2;
    const oneWay = road.directionMode === 'one-way';

    // Solid edge lines sit just inside the carriageway, on the asphalt, and
    // break where another road joins: a line running straight across the
    // mouth of a side road or slip road walled it off.
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
    ctx.save();
    this.clipOutMouths(ctx, road);
    this.strokeRoadLine(ctx, road, 2, half - 5);
    this.strokeRoadLine(ctx, road, 2, -(half - 5));
    ctx.restore();

    if (oneWay) {
      // A one-way road has no opposing flow, so no yellow divider: a white
      // dashed line plus arrows tells the driver which way the road runs.
      ctx.strokeStyle = '#e2e8f0';
      ctx.setLineDash([16, 18]);
      this.strokeRoadLine(ctx, road, 2.2, 0);
    } else {
      ctx.strokeStyle = '#eab308';
      ctx.setLineDash([]);
      this.strokeRoadLine(ctx, road, 2.6, 3.5);
      this.strokeRoadLine(ctx, road, 2.6, -3.5);
    }
    if (overview) {
      ctx.setLineDash([]);
      return;
    }

    // Lane dividers sit midway between the lane centers traffic actually
    // drives on (34 and 88 from the centerline), not at width / 4.
    if (road.lanesPerDirection === 2) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.setLineDash([16, 18]);
      this.strokeRoadLine(ctx, road, 2.2, 61);
      this.strokeRoadLine(ctx, road, 2.2, -61);
    }
    ctx.setLineDash([]);

    if (oneWay) this.renderOneWayArrows(ctx, road, cityMap);
  }

  /** Painted lane arrows along a one-way road, pointing with the traffic. */
  private renderOneWayArrows(ctx: CanvasRenderingContext2D, road: RoadSegment, cityMap: CityMap) {
    const points = this.roadPoints(road);
    const laneOffsets = road.lanesPerDirection === 2 ? [34, 88, -34, -88] : [26, -26];
    const spacing = 360;
    const clearOfJunction = (x: number, y: number) => cityMap.intersections.every((inter) => {
      const reach = inter.size / 2 + CROSSWALK_DEPTH + 40;
      return Math.abs(x - inter.x) > reach || Math.abs(y - inter.y) > reach;
    });

    ctx.fillStyle = 'rgba(241, 245, 249, 0.82)';
    let nextArrow = spacing / 2; // distance from the road start
    let segmentStart = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1) continue;
      const tx = (b.x - a.x) / length;
      const ty = (b.y - a.y) / length;
      for (; nextArrow < segmentStart + length; nextArrow += spacing) {
        const along = nextArrow - segmentStart;
        const cx = a.x + tx * along;
        const cy = a.y + ty * along;
        if (!clearOfJunction(cx, cy)) continue;
        laneOffsets.forEach((offset) => {
          ctx.save();
          ctx.translate(cx - ty * offset, cy + tx * offset);
          ctx.rotate(Math.atan2(ty, tx));
          ctx.beginPath();
          ctx.moveTo(18, 0);
          ctx.lineTo(4, -9);
          ctx.lineTo(4, -3.5);
          ctx.lineTo(-18, -3.5);
          ctx.lineTo(-18, 3.5);
          ctx.lineTo(4, 3.5);
          ctx.lineTo(4, 9);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        });
      }
      segmentStart += length;
    }
  }

  /**
   * For every road, the carriageways of the roads that end on it: a side
   * road, a driveway, a slip road or the ring at its T-junction. Each is the
   * last stretch of the joining road up to its end, pulled back a little so
   * a driveway that runs across to the far curb leaves that curb's line.
   */
  private findRoadMouths(roads: RoadSegment[]) {
    const mouths = new Map<string, Point[][]>();
    /** Distance along `line` to each point where it crosses `road`'s centerline. */
    const crossingsAlong = (line: Point[], road: Point[]) => {
      const found: { s: number; at: Point }[] = [];
      let travelled = 0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        for (let j = 1; j < road.length; j++) {
          const c = road[j - 1];
          const d = road[j];
          const denom = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
          if (Math.abs(denom) < 1e-9) continue;
          const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denom;
          const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denom;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) {
            found.push({ s: travelled + t * length, at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } });
          }
        }
        travelled += length;
      }
      return found;
    };
    const graded = (road: RoadSegment, other: RoadSegment, at: Point) => [road, other].some((candidate) =>
      candidate.gradeCrossings?.some((point) => Math.hypot(point.x - at.x, point.y - at.y) < 8));
    roads.forEach((road) => {
      const polygons: Point[][] = [];
      roads.forEach((other) => {
        if (other === road || other.points.length < 2) return;
        // Ends on this road: a T-junction or a slip road.
        [other.points, [...other.points].reverse()].forEach((line) => {
          if (distanceToPolyline(line[0], road.points) > road.width / 2 + 6) return;
          const polygon = this.carriagewayBetween(line, other.width / 2, 8, road.width + 60);
          if (polygon) polygons.push(polygon);
        });
        // Crosses it at grade (not over a bridge or through a tunnel).
        const reach = road.width / 2 + 40;
        crossingsAlong(other.points, road.points).forEach(({ s, at }) => {
          if (graded(road, other, at)) return;
          // Kept 8px short of the road's own ends, like the T-junction case: a
          // driveway that runs across to the far curb leaves that curb's line.
          const total = other.points.reduce((sum, point, index) =>
            (index === 0 ? 0 : sum + Math.hypot(point.x - other.points[index - 1].x, point.y - other.points[index - 1].y)), 0);
          const polygon = this.carriagewayBetween(other.points, other.width / 2, Math.max(8, s - reach), Math.min(total - 8, s + reach));
          if (polygon) polygons.push(polygon);
        });
      });
      if (polygons.length) mouths.set(road.id, polygons);
    });
    return mouths;
  }

  /** Outline of a road's carriageway between distances `from` and `to` along its centerline. */
  private carriagewayBetween(line: Point[], half: number, from: number, to: number) {
    const part: Point[] = [];
    let travelled = 0;
    for (let i = 1; i < line.length && travelled < to; i++) {
      const a = line[i - 1];
      const b = line[i];
      const segment = Math.hypot(b.x - a.x, b.y - a.y);
      if (segment < 0.5) continue;
      const at = (d: number) => ({ x: a.x + ((b.x - a.x) * d) / segment, y: a.y + ((b.y - a.y) * d) / segment });
      if (travelled + segment > from) {
        if (!part.length) part.push(at(Math.max(0, from - travelled)));
        part.push(at(Math.min(segment, to - travelled)));
      }
      travelled += segment;
    }
    if (part.length < 2) return null;
    const left = part.map((_, index) => this.offsetVertex(part, index, half + 1));
    const right = part.map((_, index) => this.offsetVertex(part, index, -half - 1));
    return [...left, ...right.reverse()];
  }

  /** Restricts drawing to outside every mouth that opens onto this road. */
  private clipOutMouths(ctx: CanvasRenderingContext2D, road: RoadSegment) {
    const polygons = this.mouths.get(road.id);
    if (!polygons) return;
    for (const polygon of polygons) {
      ctx.beginPath();
      ctx.rect(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 3, WORLD_SIZE * 3);
      this.tracePolygon(ctx, polygon);
      ctx.clip('evenodd');
    }
  }

  /** Every road at ground level. Bridge decks come after intersections. */
  private renderRoads(ctx: CanvasRenderingContext2D, cityMap: CityMap, overview = false) {
    const groundRoads = [...cityMap.roads].sort((a, b) => this.roadLayer(a) - this.roadLayer(b));
    this.mouths = this.findRoadMouths(cityMap.roads);
    this.drivewayPoints = this.findDrivewayExtensions(cityMap);

    ctx.save();
    ctx.lineJoin = 'round';
    // Narrow roads end square: their endpoints sit on an arterial's edge or
    // centerline, and a round cap left a bulge of asphalt and sidewalk poking
    // out of the far side of the arterial.
    const capFor = (road: RoadSegment): CanvasLineCap => (road.width >= 200 ? 'round' : 'butt');

    // Sidewalks first, all together, so no road's sidewalk covers another
    // road's asphalt.
    ctx.strokeStyle = '#334155';
    groundRoads.forEach((road) => {
      ctx.lineCap = capFor(road);
      this.strokeRoadLine(ctx, road, road.width + 48);
    });

    [0, 1, 2].forEach((layer) => {
      const layerRoads = groundRoads.filter((road) => this.roadLayer(road) === layer);
      layerRoads.forEach((road) => {
        ctx.lineCap = capFor(road);
        this.renderRoadSurface(ctx, road);
      });
      ctx.lineCap = 'butt';
      layerRoads.forEach((road) => this.renderRoadMarkings(ctx, road, cityMap, overview));
      // Cuttings, portals and roof slabs go under the roads that pass over
      // the tunnels, which are laid next.
      if (layer === 0) this.renderTunnelStructures(ctx, cityMap, groundRoads);
    });
    ctx.restore();
  }

  /**
   * Elevated decks, painted after intersections so the road underneath (its
   * zebras, stop lines and markings) stays below the bridge. The spans come
   * from CityMap.gradeStructures, the same ones physics uses: ramps climb
   * over GRADE_RAMP px, the deck stays level across the crossed road, and the
   * rest of the road was already laid at ground level.
   */
  private renderBridges(ctx: CanvasRenderingContext2D, cityMap: CityMap, overview = false, only?: GradeStructure) {
    const shadowDirection = { x: 0.6, y: 0.8 };

    cityMap.gradeStructures.filter((structure) => structure.kind === 'bridge' && (!only || structure === only)).forEach((structure) => {
      const road = cityMap.roads.find((candidate) => candidate.id === structure.roadId);
      if (!road) return;
      const span = structure.samples;
      const deck: RoadSegment = { ...road, points: span.map(({ x, y }) => ({ x, y })) };

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';

      // Shadow on the ground, sliding away from the deck as it rises, so the
      // ramps read as climbing and the middle as standing clear. A filled
      // outline, not a stroke: at lift 0 its ends coincide with the deck's,
      // where a stroked line's tilted butt cap poked out.
      const shadowHalf = road.width / 2 + 15;
      const shadowEdge = (side: 1 | -1) => span.map((sample) => {
        const lift = gradeLift(structure, sample.s) * GRADE_HEIGHT;
        return {
          x: sample.x - sample.ty * shadowHalf * side + shadowDirection.x * lift,
          y: sample.y + sample.tx * shadowHalf * side + shadowDirection.y * lift,
        };
      });
      const outline = [...shadowEdge(1), ...shadowEdge(-1).reverse()];
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      ctx.beginPath();
      outline.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.closePath();
      ctx.fill();

      // Deck edge (parapet base), asphalt and markings.
      ctx.strokeStyle = '#3b4a5f';
      this.strokeRoadLine(ctx, deck, road.width + 30);
      this.renderRoadSurface(ctx, deck);
      this.renderRoadMarkings(ctx, deck, cityMap, overview);

      // Railings (physics keeps cars inside them at the same offset), and
      // expansion joints where the deck meets the ramps.
      ctx.setLineDash([]);
      ctx.strokeStyle = '#0f172a';
      this.strokeRoadLine(ctx, deck, 3, road.width / 2 + GRADE_RAIL_OFFSET + 4);
      this.strokeRoadLine(ctx, deck, 3, -road.width / 2 - GRADE_RAIL_OFFSET - 4);
      ctx.strokeStyle = '#cbd5e1';
      this.strokeRoadLine(ctx, deck, 5, road.width / 2 + GRADE_RAIL_OFFSET);
      this.strokeRoadLine(ctx, deck, 5, -road.width / 2 - GRADE_RAIL_OFFSET);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.lineWidth = 3;
      [structure.start + GRADE_RAMP, structure.end - GRADE_RAMP]
        .forEach((s) => this.strokeAcross(ctx, span, s, road.width / 2 + 11));
      ctx.restore();
    });
  }

  /**
   * The open cutting down to each tunnel, its portals, and the slab over the
   * covered stretch. Down a ramp the road sinks between retaining walls that
   * show more of their face the deeper it goes, and the light fades toward
   * the portal; the portal is a concrete headwall across the mouth. Between
   * the portals the roof is a slab at ground level under the crossing road
   * and its sidewalks, so the tunnel no longer shows as open road beside
   * them. Only the structures get walls: the dashed "walls" used to run the
   * whole length of the tunnel road, curbs included.
   */
  private renderTunnelStructures(ctx: CanvasRenderingContext2D, cityMap: CityMap, groundRoads: RoadSegment[]) {
    cityMap.gradeStructures.filter((structure) => structure.kind === 'tunnel').forEach((structure) => {
      const span = structure.samples;
      const wall = structure.width / 2 + GRADE_RAIL_OFFSET;
      const portals = [structure.start + GRADE_RAMP, structure.end - GRADE_RAMP];
      ctx.save();
      ctx.setLineDash([]);

      // The deeper the road, the darker.
      for (let i = 1; i < span.length; i++) {
        const lift = gradeLift(structure, (span[i - 1].s + span[i].s) / 2);
        if (lift <= 0 || lift >= 1) continue;
        ctx.fillStyle = `rgba(2, 6, 23, ${(0.55 * lift * lift).toFixed(3)})`;
        this.fillAcross(ctx, span[i - 1], span[i], wall);
      }

      // Retaining walls: the face inside, the coping on top.
      ctx.lineCap = 'round';
      for (let i = 1; i < span.length; i++) {
        const a = span[i - 1];
        const b = span[i];
        const lift = gradeLift(structure, (a.s + b.s) / 2);
        if (lift <= 0 || lift >= 1) continue;
        const face = 2 + lift * 9;
        ([1, -1] as const).forEach((side) => {
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.lineWidth = face;
          this.strokeAlong(ctx, a, b, side * (wall - face / 2));
          ctx.strokeStyle = '#7b8aa0';
          ctx.lineWidth = 4;
          this.strokeAlong(ctx, a, b, side * (wall + 2));
        });
      }

      // Roof slab between the portals. Whatever road crosses it gets its
      // sidewalks laid again on top; its asphalt comes with the next layers.
      const roof = this.outlineBetween(span, portals[0], portals[1], wall + 8);
      if (roof) {
        ctx.fillStyle = '#2a3443';
        this.fillPolygon(ctx, roof);
        ctx.save();
        ctx.beginPath();
        this.tracePolygon(ctx, roof);
        ctx.clip();
        ctx.strokeStyle = '#334155';
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        groundRoads.filter((road) => road.feature !== 'tunnel').forEach((road) => this.strokeRoadLine(ctx, road, road.width + 48));
        ctx.restore();
      }

      // Portals: the dark mouth, then the headwall across it.
      ctx.lineCap = 'butt';
      portals.forEach((s, index) => {
        const out = index === 0 ? -1 : 1; // toward the open cutting
        const mouth = this.outlineBetween(span, Math.min(s, s + out * 24), Math.max(s, s + out * 24), wall);
        if (mouth) {
          ctx.fillStyle = 'rgba(2, 6, 23, 0.6)';
          this.fillPolygon(ctx, mouth);
        }
        ctx.strokeStyle = '#0b1120';
        ctx.lineWidth = 16;
        this.strokeAcross(ctx, span, s, wall + 10);
        ctx.strokeStyle = '#8391a7';
        ctx.lineWidth = 10;
        this.strokeAcross(ctx, span, s, wall + 8);
        ctx.strokeStyle = '#c3cddb';
        ctx.lineWidth = 2;
        this.strokeAcross(ctx, span, s + out * 4, wall + 8);
      });
      ctx.restore();
    });
  }

  /**
   * Inside of each covered tunnel stretch, baked where the roof was (the roof
   * itself was cut out into an overlay first). Seen only while the roof fades
   * over a player in the tunnel: lit lanes between the walls.
   */
  private renderTunnelInteriors(ctx: CanvasRenderingContext2D, cityMap: CityMap, overview: boolean) {
    cityMap.gradeStructures.filter((structure) => structure.kind === 'tunnel').forEach((structure) => {
      const road = cityMap.roads.find((candidate) => candidate.id === structure.roadId);
      if (!road) return;
      const from = structure.start + GRADE_RAMP;
      const to = structure.end - GRADE_RAMP;
      const wall = structure.width / 2 + GRADE_RAIL_OFFSET;
      const inside = this.outlineBetween(structure.samples, from, to, wall + 14);
      if (!inside) return;
      const centerline = structure.samples.filter((sample) => sample.s >= from && sample.s <= to);
      const bore: RoadSegment = { ...road, points: centerline.map(({ x, y }) => ({ x, y })) };

      ctx.save();
      ctx.beginPath();
      this.tracePolygon(ctx, inside);
      ctx.clip();
      ctx.fillStyle = '#0b1120';
      this.fillPolygon(ctx, inside);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      this.renderRoadSurface(ctx, bore);
      this.renderRoadMarkings(ctx, bore, cityMap, overview);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.3)';
      this.fillPolygon(ctx, inside);
      ctx.strokeStyle = '#475569';
      this.strokeRoadLine(ctx, bore, 6, wall);
      this.strokeRoadLine(ctx, bore, 6, -wall);
      // Lamp strips along both walls (down the middle they read as gaps in
      // the double centerline).
      ctx.fillStyle = 'rgba(253, 230, 138, 0.8)';
      for (let i = 2; i < centerline.length; i += 4) {
        const sample = centerline[i];
        ctx.save();
        ctx.translate(sample.x, sample.y);
        ctx.rotate(Math.atan2(sample.ty, sample.tx));
        ctx.fillRect(-12, wall - 9, 24, 3);
        ctx.fillRect(-12, -wall + 6, 24, 3);
        ctx.restore();
      }
      ctx.restore();
    });
  }

  /** Outline of the band `half` wide either side of the samples between `from` and `to`. */
  private outlineBetween(samples: GradeSample[], from: number, to: number, half: number) {
    const inside = samples.filter((sample) => sample.s >= from - 0.5 && sample.s <= to + 0.5);
    if (inside.length < 2) return null;
    const edge = (side: 1 | -1) => inside.map((sample) => ({
      x: sample.x - sample.ty * half * side,
      y: sample.y + sample.tx * half * side,
    }));
    return [...edge(1), ...edge(-1).reverse()];
  }

  private tracePolygon(ctx: CanvasRenderingContext2D, polygon: Point[]) {
    polygon.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.closePath();
  }

  private fillPolygon(ctx: CanvasRenderingContext2D, polygon: Point[]) {
    ctx.beginPath();
    this.tracePolygon(ctx, polygon);
    ctx.fill();
  }

  /** Fills the band `half` wide either side of the stretch from a to b. */
  private fillAcross(ctx: CanvasRenderingContext2D, a: GradeSample, b: GradeSample, half: number) {
    this.fillPolygon(ctx, [
      { x: a.x - a.ty * half, y: a.y + a.tx * half },
      { x: b.x - b.ty * half, y: b.y + b.tx * half },
      { x: b.x + b.ty * half, y: b.y - b.tx * half },
      { x: a.x + a.ty * half, y: a.y - a.tx * half },
    ]);
  }

  /** Strokes the stretch from a to b shifted sideways by `offset`. */
  private strokeAlong(ctx: CanvasRenderingContext2D, a: GradeSample, b: GradeSample, offset: number) {
    ctx.beginPath();
    ctx.moveTo(a.x - a.ty * offset, a.y + a.tx * offset);
    ctx.lineTo(b.x - b.ty * offset, b.y + b.tx * offset);
    ctx.stroke();
  }

  /** A straight line across the road at distance `s` along the samples. */
  private strokeAcross(ctx: CanvasRenderingContext2D, samples: GradeSample[], s: number, reach: number) {
    const at = samples.reduce((best, sample) => (Math.abs(sample.s - s) < Math.abs(best.s - s) ? sample : best));
    ctx.beginPath();
    ctx.moveTo(at.x + at.ty * reach, at.y - at.tx * reach);
    ctx.lineTo(at.x - at.ty * reach, at.y + at.tx * reach);
    ctx.stroke();
  }

  /**
   * Pieces of the static scene that must be drawn over vehicles on a lower
   * level: bridge decks (over ground traffic) and the roof of each covered
   * tunnel stretch (over tunnel traffic). Each is cropped to its own bounds
   * so it costs a small texture instead of a second world-size one. Rects are
   * in world units; canvases are at the baker's scale.
   */
  public getGradeOverlays(cityMap: CityMap): GradeOverlay[] {
    const scene = this.getStaticScene(cityMap);
    if (!scene) return [];
    const scale = this.scale;
    const overlays: GradeOverlay[] = [];

    cityMap.gradeStructures.forEach((structure) => {
      const x = Math.max(0, Math.floor(structure.bounds.minX));
      const y = Math.max(0, Math.floor(structure.bounds.minY));
      const width = Math.min(WORLD_SIZE, Math.ceil(structure.bounds.maxX)) - x;
      const height = Math.min(WORLD_SIZE, Math.ceil(structure.bounds.maxY)) - y;
      if (width <= 0 || height <= 0) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);

      if (structure.kind === 'bridge') {
        if (!this.bakeBridges) {
          // The deck and its shadow, drawn on their own: the baked scene has
          // only the ground under them.
          this.renderBridges(ctx, cityMap, false, structure);
          overlays.push({ kind: structure.kind, structure, canvas, x, y, width, height });
          return;
        }
        // The deck and its shadow, copied from the baked scene, which already
        // has them drawn over everything else.
        this.clipToStructure(ctx, structure, structure.start, structure.end, structure.width / 2 + GRADE_RAIL_OFFSET + 6, GRADE_HEIGHT);
      } else {
        // In game mode the roof was cut out before the interior went in.
        const roof = this.tunnelRoofs?.find((overlay) => overlay.structure === structure);
        if (roof) {
          overlays.push(roof);
          return;
        }
        // The roof: whatever the baked scene shows over the covered stretch
        // (the crossing road, its sidewalks and the tunnel mouths).
        this.clipToStructure(ctx, structure, structure.start + GRADE_RAMP, structure.end - GRADE_RAMP, structure.width / 2 + GRADE_RAIL_OFFSET + 14, 0);
      }
      ctx.drawImage(scene, 0, 0, scene.width, scene.height, 0, 0, WORLD_SIZE, WORLD_SIZE);
      overlays.push({ kind: structure.kind, structure, canvas, x, y, width, height });
    });
    return overlays;
  }

  /**
   * The roof over a covered tunnel stretch, cut from the scene as it stands:
   * the slab, the crossing road and its sidewalks.
   */
  private cropTunnelRoof(scene: HTMLCanvasElement, structure: GradeStructure): GradeOverlay | null {
    const scale = this.scale;
    const x = Math.max(0, Math.floor(structure.bounds.minX));
    const y = Math.max(0, Math.floor(structure.bounds.minY));
    const width = Math.min(WORLD_SIZE, Math.ceil(structure.bounds.maxX)) - x;
    const height = Math.min(WORLD_SIZE, Math.ceil(structure.bounds.maxY)) - y;
    if (width <= 0 || height <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    this.clipToStructure(ctx, structure, structure.start + GRADE_RAMP, structure.end - GRADE_RAMP, structure.width / 2 + GRADE_RAIL_OFFSET + 14, 0);
    ctx.drawImage(scene, 0, 0, scene.width, scene.height, 0, 0, WORLD_SIZE, WORLD_SIZE);
    return { kind: 'tunnel', structure, canvas, x, y, width, height };
  }

  /** Clips to the structure's outline between `from` and `to`, plus its shadow. */
  private clipToStructure(ctx: CanvasRenderingContext2D, structure: GradeStructure, from: number, to: number, half: number, shadow: number) {
    const samples = structure.samples.filter((sample) => sample.s >= from - 0.5 && sample.s <= to + 0.5);
    if (samples.length < 2) return;
    const edge = (side: 1 | -1, withShadow: boolean) => samples.map((sample) => {
      const lift = withShadow ? gradeLift(structure, sample.s) * shadow : 0;
      return {
        x: sample.x - sample.ty * half * side + 0.6 * lift,
        y: sample.y + sample.tx * half * side + 0.8 * lift,
      };
    });
    ctx.beginPath();
    [false, true].forEach((withShadow) => {
      const outline = [...edge(1, withShadow), ...edge(-1, withShadow).reverse()];
      outline.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.closePath();
    });
    ctx.clip('nonzero');
  }

  private renderIntersections(ctx: CanvasRenderingContext2D, cityMap: CityMap, overview = false) {
    cityMap.intersections.forEach((inter) => {
      if (overview && inter.trafficControlled !== false) return;
      ctx.save();
      const half = inter.size / 2;

      if (inter.trafficControlled === false) {
        // Uncontrolled landmarks are not signalized four-way junctions. A
        // square zebra template here made the market roundabout and T-junctions
        // look like extra roads that do not exist.
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        if (inter.kind === 'roundabout' || inter.id.includes('roundabout')) {
          ctx.arc(inter.x, inter.y, half, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.fillStyle = '#14532d';
          ctx.beginPath();
          ctx.arc(inter.x, inter.y, Math.max(18, half * 0.48), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 3;
          ctx.setLineDash([10, 8]);
          ctx.beginPath();
          ctx.arc(inter.x, inter.y, Math.max(26, half * 0.7), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
        return;
      }

      const stripeWidth = 10;
      const stripeGap = 8;
      const zebraLen = CROSSWALK_DEPTH;
      const stopOffset = half + zebraLen + 8;

      // Junction box plus every approach up to its stop line is bare asphalt:
      // centerlines and lane dashes end at the stop line instead of running
      // through the zebra (they showed between its stripes) and into the box.
      ctx.fillStyle = '#1e2530';
      ctx.fillRect(inter.x - half, inter.y - half, inter.size, inter.size);
      const mouth = inter.size - 10;
      ctx.fillRect(inter.x - mouth / 2, inter.y - stopOffset, mouth, stopOffset - half);
      ctx.fillRect(inter.x - mouth / 2, inter.y + half, mouth, stopOffset - half);
      ctx.fillRect(inter.x - stopOffset, inter.y - mouth / 2, stopOffset - half, mouth);
      ctx.fillRect(inter.x + half, inter.y - mouth / 2, stopOffset - half, mouth);

      ctx.fillStyle = '#ffffff';

      // North Zebra
      for (let x = inter.x - half + 6; x < inter.x + half - 6; x += stripeWidth + stripeGap) {
        ctx.fillRect(x, inter.y - half - zebraLen, stripeWidth, zebraLen);
      }
      // South Zebra
      for (let x = inter.x - half + 6; x < inter.x + half - 6; x += stripeWidth + stripeGap) {
        ctx.fillRect(x, inter.y + half, stripeWidth, zebraLen);
      }
      // West Zebra
      for (let y = inter.y - half + 6; y < inter.y + half - 6; y += stripeWidth + stripeGap) {
        ctx.fillRect(inter.x - half - zebraLen, y, zebraLen, stripeWidth);
      }
      // East Zebra
      for (let y = inter.y - half + 6; y < inter.y + half - 6; y += stripeWidth + stripeGap) {
        ctx.fillRect(inter.x + half, y, zebraLen, stripeWidth);
      }

      // Yellow tactile sidewalk corner pads (matching screenshots!)
      ctx.fillStyle = '#eab308';
      ctx.fillRect(inter.x - half - 22, inter.y - half - 22, 18, 18);
      ctx.fillRect(inter.x + half + 4, inter.y - half - 22, 18, 18);
      ctx.fillRect(inter.x - half - 22, inter.y + half + 4, 18, 18);
      ctx.fillRect(inter.x + half + 4, inter.y + half + 4, 18, 18);

      // Stop lines sit upstream of the crosswalk and span only the inbound
      // half, on the side TrafficAI drives (south-bound east of center,
      // east-bound south of it). A one-way road gets none on its exit side.
      const through = (vertical: boolean) => cityMap.roads.find((road) => road.width >= 200
        && road.isVertical === vertical
        && Math.abs((vertical ? road.x1 : road.y1) - (vertical ? inter.x : inter.y)) < 4);
      const allows = (vertical: boolean, positiveTravel: boolean) => {
        const road = through(vertical);
        if (!road || road.directionMode !== 'one-way') return true;
        const forward = vertical ? road.y2 >= road.y1 : road.x2 >= road.x1;
        return forward === positiveTravel;
      };
      const inbound = mouth / 2;
      ctx.fillStyle = '#f8fafc';
      if (allows(true, true)) ctx.fillRect(inter.x, inter.y - stopOffset - 2, inbound, 5); // from north
      if (allows(true, false)) ctx.fillRect(inter.x - inbound, inter.y + stopOffset - 3, inbound, 5); // from south
      if (allows(false, true)) ctx.fillRect(inter.x - stopOffset - 2, inter.y, 5, inbound); // from west
      if (allows(false, false)) ctx.fillRect(inter.x + stopOffset - 3, inter.y - inbound, 5, inbound); // from east

      ctx.restore();
    });
  }

  private renderPOIs(
    ctx: CanvasRenderingContext2D,
    pois: PointOfInterest[],
    targetPoi: PointOfInterest | null
  ) {
    pois.forEach((poi) => {
      if (!this.isVisible(poi.x, poi.y, poi.width, poi.height)) return;
      ctx.save();
      const isTarget = targetPoi?.id === poi.id;

      // Paved yard base
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(poi.x - poi.width / 2, poi.y - poi.height / 2, poi.width, poi.height);

      // Yard border
      ctx.strokeStyle = isTarget ? '#eab308' : poi.color;
      ctx.lineWidth = isTarget ? 4 : 2;
      ctx.strokeRect(poi.x - poi.width / 2, poi.y - poi.height / 2, poi.width, poi.height);

      // Parking bays
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      for (let px = poi.x - poi.width / 2 + 30; px < poi.x + poi.width / 2 - 30; px += 40) {
        ctx.strokeRect(px, poi.y + poi.height / 2 - 50, 32, 45);
      }

      // POI Nameplate
      ctx.fillStyle = poi.color;
      ctx.font = 'bold 13px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(poi.nameRu.toUpperCase(), poi.x, poi.y - poi.height / 2 + 20);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px "JetBrains Mono", sans-serif';
      ctx.fillText(poi.name, poi.x, poi.y - poi.height / 2 + 36);

      ctx.restore();
    });
  }

  private renderBuildings(ctx: CanvasRenderingContext2D, buildings: Building[]) {
    buildings.forEach((b) => {
      if (!this.isVisible(b.x, b.y, b.width, b.height)) return;
      ctx.save();
      // Drop Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(b.x - b.width / 2 + 8, b.y - b.height / 2 + 8, b.width, b.height);

      // Building Wall Base
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);

      // Building Roof Top
      ctx.fillStyle = b.roofColor;
      ctx.fillRect(
        b.x - b.width / 2 + 10,
        b.y - b.height / 2 + 10,
        b.width - 20,
        b.height - 20
      );

      // Neon Accent Border (as seen in screenshots!)
      if (b.neonBorderColor) {
        ctx.strokeStyle = b.neonBorderColor;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(
          b.x - b.width / 2 + 2,
          b.y - b.height / 2 + 2,
          b.width - 4,
          b.height - 4
        );
      }

      // Roof HVAC units
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(b.x - 20, b.y - 20, 40, 40);
      ctx.strokeStyle = '#475569';
      ctx.strokeRect(b.x - 20, b.y - 20, 40, 40);

      ctx.restore();
    });
  }

}
