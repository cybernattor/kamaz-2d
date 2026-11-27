import { PointOfInterest, MapDecoration, MapTrail } from '../types';
import { Building, CityDistrict, CityMap, CROSSWALK_DEPTH, RoadSegment, WORLD_SIZE } from './cityMap';

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

  /** Supersample the snapshot; the GPU renderer asks for screen density. */
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
    this.renderRoads(ctx, cityMap.roads, overview);
    this.renderIntersections(ctx, cityMap, overview);
    this.renderPOIs(ctx, cityMap.pois, null);
    this.renderBuildings(ctx, cityMap.buildings);

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
   * Bridge/tunnel roads share on-screen space with whatever they cross at
   * grade, so paint order decides which one reads as "above". Sorting only
   * the draw pass (never CityMap.roads itself, which other systems iterate
   * order-independently) keeps tunnels underneath the road that crosses them
   * and bridges on top of it, regardless of which was generated first.
   */
  private roadZOrder(road: RoadSegment) {
    return road.feature === 'tunnel' ? -1 : road.feature === 'bridge' ? 1 : 0;
  }

  /** Local tangent direction of a road's polyline nearest to `at`. */
  private tangentNear(road: RoadSegment, at: { x: number; y: number }) {
    let best = Infinity;
    let tangent = { x: 1, y: 0 };
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSquared));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const distance = Math.hypot(at.x - px, at.y - py);
      if (distance < best) {
        best = distance;
        tangent = { x: dx, y: dy };
      }
    }
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    return { x: tangent.x / length, y: tangent.y / length };
  }

  /**
   * Grade-separation cues at a bridge/tunnel road's crossing points. Without
   * these, a bridge and the road it passes over just look like two flat
   * carriageways painted on top of each other; with them, the bridge reads
   * as elevated (drop shadow + pier stubs) and the tunnel reads as sunken
   * (dark portal mouths either side of the crossing).
   */
  private renderGradeCrossings(ctx: CanvasRenderingContext2D, road: RoadSegment) {
    if (!road.gradeCrossings?.length) return;
    // Every bridge/tunnel on this map only ever crosses a full arterial
    // (110 half-width + 24 sidewalk halo = 134px reach), so a fixed
    // clearance keeps these cues outside that halo without needing to look
    // up which road is actually being crossed.
    const arterialHaloReach = 134;

    road.gradeCrossings.forEach((point) => {
      const tangent = this.tangentNear(road, point);
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(Math.atan2(tangent.y, tangent.x));

      if (road.feature === 'bridge') {
        // Shade the lower road beyond the deck edges and place supports
        // outside the bridge's drivable surface.
        ctx.fillStyle = 'rgba(2, 6, 23, 0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 0, arterialHaloReach + 18, road.width / 2 + 34, 0, 0, Math.PI * 2);
        ctx.fill();
        [-1, 1].forEach((along) => [-1, 1].forEach((across) => {
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(
            along * (arterialHaloReach - 8) - 9,
            across * (road.width / 2 + 12) - 9,
            18,
            18,
            4
          );
          ctx.fill();
          ctx.stroke();
        }));
      } else {
        // Small portal marks show where the road dips under without hiding
        // the full-width carriageway on the overview map.
        [-1, 1].forEach((direction) => {
          const offset = direction * (arterialHaloReach + 10);
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(offset - 10, -28, 20, 56, 5);
          ctx.fill();
          ctx.stroke();
        });
      }
      ctx.restore();
    });
  }

  private renderRoads(ctx: CanvasRenderingContext2D, roads: RoadSegment[], overview = false) {
    const drawOrder = [...roads].sort((a, b) => this.roadZOrder(a) - this.roadZOrder(b));
    const bridges = drawOrder.filter((road) => road.feature === 'bridge');
    const groundRoads = drawOrder.filter((road) => road.feature !== 'bridge');
    const drawRoadLine = (road: RoadSegment, width: number, offset = 0) => {
      const points = road.points.length > 1 ? road.points : [{ x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }];
      ctx.lineWidth = width;
      ctx.beginPath();
      points.forEach((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const tangentX = next.x - previous.x;
        const tangentY = next.y - previous.y;
        const length = Math.hypot(tangentX, tangentY) || 1;
        const x = point.x - (tangentY / length) * offset;
        const y = point.y + (tangentX / length) * offset;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    // Paint every shoulder before any asphalt. Drawing each road completely
    // in sequence let a later road's wide shoulder cover an earlier road.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawOrder.forEach((road) => {
      ctx.strokeStyle = '#334155';
      drawRoadLine(road, road.width + 48);
    });

    groundRoads.forEach((road) => {
      ctx.strokeStyle = road.roadClass === 'dirt' ? '#9a6b30' : road.roadClass === 'highway' ? '#202938' : '#1e2530';
      drawRoadLine(road, road.width);
    });

    // Bridges get their shadow between the lower road and the deck, so their
    // centerlines and lane markings cannot bleed through the overpass.
    bridges.forEach((road) => this.renderGradeCrossings(ctx, road));
    bridges.forEach((road) => {
      ctx.strokeStyle = road.roadClass === 'dirt' ? '#9a6b30' : road.roadClass === 'highway' ? '#202938' : '#1e2530';
      drawRoadLine(road, road.width);
    });

    [...groundRoads, ...bridges].forEach((road) => {
      ctx.strokeStyle = '#64748b';
      drawRoadLine(road, 2, road.width / 2);
      drawRoadLine(road, 2, -road.width / 2);

      if (road.roadClass !== 'dirt') {
        ctx.strokeStyle = '#eab308';
        ctx.setLineDash([]);
        drawRoadLine(road, road.directionMode === 'one-way' ? 2 : 3, road.directionMode === 'one-way' ? 0 : 3);
        if (road.directionMode !== 'one-way') drawRoadLine(road, 3, -3);

        if (overview) return;
        const laneWidth = road.width / (road.lanesPerDirection * 2);
        ctx.strokeStyle = '#f8fafc';
        ctx.setLineDash([16, 18]);
        for (let lane = 1; lane < road.lanesPerDirection * 2; lane += 1) {
          if (road.directionMode === 'one-way' && lane === road.lanesPerDirection) continue;
          const offset = -road.width / 2 + laneWidth * lane;
          drawRoadLine(road, 2.2, offset);
        }
      } else {
        ctx.strokeStyle = '#f1d39b';
        ctx.setLineDash([14, 12]);
        drawRoadLine(road, 2);
      }
      if (road.feature === 'bridge' || road.feature === 'tunnel') {
        ctx.strokeStyle = road.feature === 'bridge' ? '#93c5fd' : '#64748b';
        ctx.setLineDash(road.feature === 'bridge' ? [] : [28, 20]);
        drawRoadLine(road, 5, road.width / 2 + 11);
        drawRoadLine(road, 5, -road.width / 2 - 11);
      }
    });
    ctx.setLineDash([]);
    ctx.restore();

    // Portals cover the road that passes above the tunnel.
    groundRoads.filter((road) => road.feature === 'tunnel')
      .forEach((road) => this.renderGradeCrossings(ctx, road));
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

      // Center intersection asphalt
      ctx.fillStyle = '#1e2530';
      ctx.fillRect(inter.x - half, inter.y - half, inter.size, inter.size);

      // Render 4 Zebra Crosswalks (Crisp White Bars Matching Screenshots!)
      const stripeWidth = 10;
      const stripeGap = 8;
      const zebraLen = CROSSWALK_DEPTH;

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

      // Keep stop lines upstream of the full crosswalk, with a small buffer.
      ctx.fillStyle = '#f8fafc';
      const stopOffset = half + zebraLen + 8;
      ctx.fillRect(inter.x - half, inter.y - stopOffset - 2, inter.size, 4);
      ctx.fillRect(inter.x - half, inter.y + stopOffset - 2, inter.size, 4);
      ctx.fillRect(inter.x - stopOffset - 2, inter.y - half, 4, inter.size);
      ctx.fillRect(inter.x + stopOffset - 2, inter.y - half, 4, inter.size);

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
