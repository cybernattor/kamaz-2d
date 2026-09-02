import {
  DestructibleObject,
  Particle,
  Pedestrian,
  PlayerCharacter,
  PointOfInterest,
  RemotePlayer,
  SkidMark,
  TrafficLight,
  VehicleInstance,
} from '../types';
import { Building, CityDistrict, CityMap, RoadSegment, WORLD_SIZE } from './cityMap';
import { MapDecoration, MapTrail } from '../types';
import { VEHICLE_CONFIGS } from './vehicleConfigs';

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  public cameraX = 1200;
  public cameraY = 1200;
  public zoom = 1.0;
  public frameDelta = 1 / 60;

  // Day/Night time factor (0 = Night 00:00, 0.5 = Noon 12:00, 1.0 = Night 24:00)
  public timeOfDay = 0.5; // Starts at Noon (12:00) as in screenshot
  public isNightMode = false;
  private viewBounds = { left: 0, top: 0, right: WORLD_SIZE, bottom: WORLD_SIZE };
  private staticScene: HTMLCanvasElement | null = null;
  private staticSceneMap: CityMap | null = null;
  private staticSceneScale = 1;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  public resize(_width: number, _height: number) {
    // Canvas fallback uses the host canvas dimensions directly.
  }

  public setZoom(value: number) {
    this.zoom = value;
  }

  public setNightMode(value: boolean) {
    this.isNightMode = value;
  }

  public destroy() {
    // No external resources are owned by the Canvas fallback.
  }

  /**
   * Supersamples the one-off city snapshot. The GPU renderer asks for screen
   * density so the map stays sharp under the camera; the Canvas path keeps 1:1
   * because it blits the snapshot at world scale.
   */
  public setStaticSceneScale(scale: number) {
    const next = Math.max(0.25, scale);
    if (next === this.staticSceneScale) return;
    this.staticSceneScale = next;
    this.staticScene = null;
    this.staticSceneMap = null;
  }

  public getStaticSceneScale() {
    return this.staticSceneScale;
  }

  public getStaticScene(cityMap: CityMap) {
    this.ensureStaticScene(cityMap);
    return this.staticScene;
  }

  public render(
    canvasWidth: number,
    canvasHeight: number,
    cityMap: CityMap,
    playerVehicle: VehicleInstance | null,
    playerChar: PlayerCharacter,
    inVehicle: boolean,
    trafficCars: VehicleInstance[],
    remotePlayers: RemotePlayer[],
    pedestrians: Pedestrian[],
    destructibles: DestructibleObject[],
    particles: Particle[],
    skidMarks: SkidMark[],
    targetPoi: PointOfInterest | null
  ) {
    const ctx = this.ctx;

    // 1. Update Camera Position smoothly
    const focusX = inVehicle && playerVehicle ? playerVehicle.x : playerChar.x;
    const focusY = inVehicle && playerVehicle ? playerVehicle.y : playerChar.y;
    const frameDelta = Math.min(Math.max(this.frameDelta, 1 / 120), 0.05);
    const follow = 1 - Math.exp(-9 * frameDelta);
    this.cameraX += (focusX - this.cameraX) * follow;
    this.cameraY += (focusY - this.cameraY) * follow;
    const viewHalfWidth = canvasWidth / (2 * this.zoom);
    const viewHalfHeight = canvasHeight / (2 * this.zoom);
    this.viewBounds = {
      left: this.cameraX - viewHalfWidth - 160,
      top: this.cameraY - viewHalfHeight - 160,
      right: this.cameraX + viewHalfWidth + 160,
      bottom: this.cameraY + viewHalfHeight + 160,
    };
    this.ensureStaticScene(cityMap);

    ctx.save();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Apply Camera Transform & Zoom
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    // Static geometry is rendered once to an offscreen canvas. Only the
    // visible crop is copied each frame; moving objects remain on the live
    // canvas below it.
    this.drawStaticScene(ctx, canvasWidth, canvasHeight);

    // 5. Render Skid Marks
    this.renderSkidMarks(ctx, skidMarks);

    // 7. Render Destructible Props
    this.renderDestructibles(ctx, destructibles);

    // 8. Render Traffic Lights
    this.renderTrafficLights(ctx, cityMap.trafficLights);

    // 9. Render Vehicles (NPC + Player + Remote Players)
    const allVehicles = [...trafficCars];
    if (playerVehicle && inVehicle) {
      allVehicles.push(playerVehicle);
    }
    this.renderVehicles(ctx, allVehicles, remotePlayers);

    // 10. Render Pedestrians & Player on Foot
    this.renderPedestrians(ctx, pedestrians);
    if (!inVehicle) {
      this.renderPlayerCharacter(ctx, playerChar);
    }

    // 11. Render Dynamic Lighting & Headlight Cones
    this.renderLightingPass(
      ctx,
      canvasWidth,
      canvasHeight,
      allVehicles,
      remotePlayers,
      cityMap.destructibles
    );

    // 12. Render Particles (Smoke, fire, water fountains, sparks)
    this.renderParticles(ctx, particles);

    // 13. Render Mission Target Waypoint & Beacon
    if (targetPoi) {
      this.renderTargetBeacon(ctx, targetPoi);
    }

    ctx.restore();
  }

  private ensureStaticScene(cityMap: CityMap) {
    if (this.staticSceneMap === cityMap && this.staticScene) return;

    const scale = this.staticSceneScale;
    const scene = document.createElement('canvas');
    scene.width = Math.ceil(WORLD_SIZE * scale);
    scene.height = Math.ceil(WORLD_SIZE * scale);
    const sceneCtx = scene.getContext('2d');
    if (!sceneCtx) return;
    sceneCtx.setTransform(scale, 0, 0, scale, 0, 0);

    const previousBounds = this.viewBounds;
    this.viewBounds = { left: 0, top: 0, right: WORLD_SIZE, bottom: WORLD_SIZE };
    this.renderGround(sceneCtx);
    this.renderDistricts(sceneCtx, cityMap.districts);
    this.renderMapDecorations(sceneCtx, cityMap.decorations);
    this.renderScenicRoutes(sceneCtx, cityMap.scenicRoutes);
    this.renderRoads(sceneCtx, cityMap.roads);
    this.renderIntersections(sceneCtx, cityMap);
    this.renderPOIs(sceneCtx, cityMap.pois, null);
    this.renderBuildings(sceneCtx, cityMap.buildings);
    this.viewBounds = previousBounds;

    this.staticScene = scene;
    this.staticSceneMap = cityMap;
  }

  private drawStaticScene(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) {
    if (!this.staticScene) return;

    const scale = this.zoom;
    const sourceWidth = Math.min(WORLD_SIZE, canvasWidth / scale + 320);
    const sourceHeight = Math.min(WORLD_SIZE, canvasHeight / scale + 320);
    const sourceX = Math.max(0, Math.min(WORLD_SIZE - sourceWidth, this.cameraX - sourceWidth / 2));
    const sourceY = Math.max(0, Math.min(WORLD_SIZE - sourceHeight, this.cameraY - sourceHeight / 2));
    // The snapshot may be supersampled, so the source rectangle lives in
    // snapshot pixels while the destination stays in world coordinates.
    const snapshotScale = this.staticSceneScale;
    ctx.drawImage(
      this.staticScene,
      sourceX * snapshotScale,
      sourceY * snapshotScale,
      sourceWidth * snapshotScale,
      sourceHeight * snapshotScale,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight
    );
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
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 24;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(route.points[0].x, route.points[0].y);
      route.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.strokeStyle = '#d6b37a';
      ctx.lineWidth = 10;
      ctx.setLineDash([18, 16]);
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

  private renderRoads(ctx: CanvasRenderingContext2D, roads: RoadSegment[]) {
    roads.forEach((road) => {
      ctx.save();
      const points = road.points.length > 1 ? road.points : [{ x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }];
      const draw = (offset = 0) => {
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

      // Sidewalk and asphalt are stroked along the full polyline, so bends do
      // not turn into disconnected rectangular slabs.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = road.width + 48;
      draw();
      ctx.strokeStyle = road.roadClass === 'dirt' ? '#9a6b30' : road.roadClass === 'highway' ? '#202938' : '#1e2530';
      ctx.lineWidth = road.width;
      draw();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      draw(road.width / 2);
      draw(-road.width / 2);

      if (road.roadClass !== 'dirt') {
        const laneWidth = road.width / (road.lanesPerDirection * 2);
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = road.directionMode === 'one-way' ? 2 : 3;
        ctx.setLineDash([]);
        draw(road.directionMode === 'one-way' ? 0 : 3);
        if (road.directionMode !== 'one-way') draw(-3);

        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([16, 18]);
        for (let lane = 1; lane < road.lanesPerDirection * 2; lane += 1) {
          if (road.directionMode === 'one-way' && lane === road.lanesPerDirection) continue;
          const offset = -road.width / 2 + laneWidth * lane;
          draw(offset);
        }
      } else {
        ctx.strokeStyle = '#f1d39b';
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 12]);
        draw();
      }
      if (road.feature === 'bridge' || road.feature === 'tunnel') {
        ctx.strokeStyle = road.feature === 'bridge' ? '#93c5fd' : '#64748b';
        ctx.lineWidth = 5;
        ctx.setLineDash([28, 20]);
        draw(road.width / 2 + 11);
        draw(-road.width / 2 - 11);
      }

      ctx.setLineDash([]);
      ctx.restore();
    });
  }

  private renderIntersections(ctx: CanvasRenderingContext2D, cityMap: CityMap) {
    cityMap.intersections.forEach((inter) => {
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
        } else {
          ctx.roundRect(inter.x - half, inter.y - half, inter.size, inter.size, 18);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      // Center intersection asphalt
      ctx.fillStyle = '#1e2530';
      ctx.fillRect(inter.x - half, inter.y - half, inter.size, inter.size);

      // Render 4 Zebra Crosswalks (Crisp White Bars Matching Screenshots!)
      const stripeWidth = 6;
      const stripeGap = 5;
      const zebraLen = 22;

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

      // Stop lines are deliberately outside the zebra crossing. The traffic
      // controller uses the same offset, so the visual line and the actual
      // stopping position stay aligned for every vehicle length.
      ctx.fillStyle = '#f8fafc';
      const stopOffset = half + 8;
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

  private renderDestructibles(ctx: CanvasRenderingContext2D, destructibles: DestructibleObject[]) {
    destructibles.forEach((obj) => {
      if (obj.isDestroyed) return;
      if (!this.isVisible(obj.x, obj.y, obj.width + 24, obj.height + 24)) return;

      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.angle);

      if (obj.type === 'cone') {
        // Orange Traffic Cone with white band
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (obj.type === 'crate') {
        // Wooden cargo crate with X-frame
        ctx.fillStyle = '#b45309';
        ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
        ctx.beginPath();
        ctx.moveTo(-obj.width / 2, -obj.height / 2);
        ctx.lineTo(obj.width / 2, obj.height / 2);
        ctx.moveTo(obj.width / 2, -obj.height / 2);
        ctx.lineTo(-obj.width / 2, obj.height / 2);
        ctx.stroke();
      } else if (obj.type === 'barrel') {
        // Oil/Fuel Barrel
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (obj.type === 'hydrant') {
        // Red Fire Hydrant
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (obj.type === 'lamp_pole') {
        // Street Lamp Pole
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (obj.type === 'fence') {
        // Wooden/Metal Fence Segment
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-obj.width / 2, -3, obj.width, 6);
        ctx.fillStyle = '#475569';
        ctx.fillRect(-obj.width / 2, -5, 6, 10);
        ctx.fillRect(obj.width / 2 - 6, -5, 6, 10);
      } else if (obj.type === 'trash_can') {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-6, -6, 12, 12);
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 2;
        ctx.strokeRect(-6, -6, 12, 12);
      }

      ctx.restore();
    });
  }

  private renderTrafficLights(ctx: CanvasRenderingContext2D, lights: TrafficLight[]) {
    lights.forEach((tl) => {
      if (!this.isVisible(tl.x, tl.y, 30, 30)) return;
      ctx.save();
      ctx.translate(tl.x, tl.y);

      // Traffic Light Housing
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-5, -14, 10, 28);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-5, -14, 10, 28);

      // Red Bulb
      ctx.fillStyle = tl.state === 'red' ? '#ef4444' : '#450a0a';
      ctx.beginPath();
      ctx.arc(0, -9, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Yellow Bulb
      ctx.fillStyle = tl.state === 'yellow' ? '#eab308' : '#422006';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Green Bulb
      ctx.fillStyle = tl.state === 'green' ? '#22c55e' : '#052e16';
      ctx.beginPath();
      ctx.arc(0, 9, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Pedestrian Signal Icon on side
      ctx.fillStyle = tl.pedestrianState === 'walk' ? '#22c55e' : '#ef4444';
      ctx.fillRect(6, -4, 5, 8);

      ctx.restore();
    });
  }

  private renderSkidMarks(ctx: CanvasRenderingContext2D, skids: SkidMark[]) {
    skids.forEach((skid) => {
      const minX = Math.min(skid.x1, skid.x2);
      const minY = Math.min(skid.y1, skid.y2);
      const maxX = Math.max(skid.x1, skid.x2);
      const maxY = Math.max(skid.y1, skid.y2);
      if (
        maxX < this.viewBounds.left ||
        minX > this.viewBounds.right ||
        maxY < this.viewBounds.top ||
        minY > this.viewBounds.bottom
      ) return;
      ctx.save();
      ctx.strokeStyle = `rgba(15, 23, 42, ${skid.alpha})`;
      ctx.lineWidth = skid.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
      ctx.stroke();
      ctx.restore();
    });
  }

  // Render Vehicles (KAMAZ Dump, Flatbed, 4x4, Ambulance, Police, Sedans, Buses)
  private renderVehicles(
    ctx: CanvasRenderingContext2D,
    vehicles: VehicleInstance[],
    remotePlayers: RemotePlayer[]
  ) {
    // Render NPC & Local Player vehicles
    vehicles.forEach((v) => {
      if (!this.isVisible(v.x, v.y, 100, 100)) return;
      this.drawVehicleBody(ctx, v);
    });

    // Render Remote Multiplayer vehicles
    remotePlayers.forEach((rp) => {
      if (rp.inVehicle && this.isVisible(rp.x, rp.y, 100, 100)) {
        const dummy: VehicleInstance = {
          id: rp.id,
          type: rp.vehicleType,
          x: rp.x,
          y: rp.y,
          angle: rp.angle,
          speed: rp.speed,
          steeringAngle: rp.steering,
          angularVelocity: 0,
          color: rp.vehicleColor,
          health: rp.condition,
          maxHealth: 100,
          headlights: rp.headlights,
          turnSignal: rp.turnSignal as 'none' | 'left' | 'right' | 'hazard',
          isBraking: false,
          isReversing: false,
          isHonking: rp.isHonking,
          isSiren: rp.isSiren,
          isPlayer: false,
          isRemotePlayer: true,
          playerName: rp.name,
          smokeTimer: 0,
        };
        this.drawVehicleBody(ctx, dummy);
      }
    });
  }

  private drawVehicleBody(ctx: CanvasRenderingContext2D, v: VehicleInstance) {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);

    const config = VEHICLE_CONFIGS[v.type];
    const halfW = config.width / 2;
    const halfL = config.length / 2;

    // Vehicle Cast Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fillRect(-halfL + 4, -halfW + 4, config.length, config.width);

    // Front Turning Wheels
    const frontAxleX = halfL * 0.65;
    const rearAxleX = -halfL * 0.6;
    const wheelW = 10;
    const wheelH = 4;

    ctx.fillStyle = '#090d16'; // Black rubber

    // Front Left Wheel
    ctx.save();
    ctx.translate(frontAxleX, -halfW - 1);
    ctx.rotate(v.steeringAngle);
    ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
    ctx.restore();

    // Front Right Wheel
    ctx.save();
    ctx.translate(frontAxleX, halfW + 1);
    ctx.rotate(v.steeringAngle);
    ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
    ctx.restore();

    // Rear Wheels (KAMAZ has dual rear axles!)
    if (v.type === 'kamaz_dump' || v.type === 'kamaz_flatbed' || v.type === 'bus') {
      // Rear Axle 1
      ctx.fillRect(rearAxleX - 8, -halfW - 2, wheelW + 2, wheelH + 1);
      ctx.fillRect(rearAxleX - 8, halfW - 1, wheelW + 2, wheelH + 1);
      // Rear Axle 2
      ctx.fillRect(rearAxleX + 10, -halfW - 2, wheelW + 2, wheelH + 1);
      ctx.fillRect(rearAxleX + 10, halfW - 1, wheelW + 2, wheelH + 1);
    } else {
      ctx.fillRect(rearAxleX - wheelW / 2, -halfW - 2, wheelW, wheelH + 1);
      ctx.fillRect(rearAxleX - wheelW / 2, halfW - 1, wheelW, wheelH + 1);
    }

    // MAIN CHASSIS / BODY
    if (v.type === 'kamaz_dump') {
      // --- KAMAZ 65115 DUMP TRUCK ---
      // Rear Dump Bed (Silver/Dark Orange with Cargo)
      ctx.fillStyle = '#ea580c'; // Vibrant Orange Cab & Bed
      ctx.fillRect(-halfL, -halfW, halfL * 1.3, config.width);
      ctx.strokeStyle = '#c2410c';
      ctx.lineWidth = 2;
      ctx.strokeRect(-halfL, -halfW, halfL * 1.3, config.width);

      // Cargo in Dump Bed (Sand/Bricks/Gravel blocks)
      ctx.fillStyle = '#d97706'; // Sand tone
      ctx.fillRect(-halfL + 6, -halfW + 4, halfL * 1.15, config.width - 8);
      // Dump ribbing
      ctx.fillStyle = '#9a3412';
      for (let rx = -halfL + 12; rx < halfL * 0.2; rx += 14) {
        ctx.fillRect(rx, -halfW + 2, 3, config.width - 4);
      }

      // Front Cab (Large square forward-control cab)
      const cabX = halfL * 0.35;
      const cabLen = halfL * 0.65;
      ctx.fillStyle = v.color || '#f97316';
      ctx.fillRect(cabX, -halfW, cabLen, config.width);
      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 2;
      ctx.strokeRect(cabX, -halfW, cabLen, config.width);

      // Windshield
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(cabX + cabLen * 0.45, -halfW + 3, 6, config.width - 6);

      // Cab Roof Air Intake / Vents
      ctx.fillStyle = '#c2410c';
      ctx.fillRect(cabX + 4, -halfW + 6, cabLen * 0.35, config.width - 12);

      // Heavy Front Bumper
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(halfL - 3, -halfW, 4, config.width);
    } else if (v.type === 'kamaz_flatbed') {
      // --- KAMAZ FLATBED ---
      ctx.fillStyle = '#334155';
      ctx.fillRect(-halfL, -halfW, halfL * 1.35, config.width);
      // Cargo Boxes on flatbed
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-halfL + 6, -halfW + 4, 24, config.width - 8);
      ctx.fillRect(-halfL + 34, -halfW + 4, 24, config.width - 8);

      // Blue Forward Cab
      const cabX = halfL * 0.4;
      const cabLen = halfL * 0.6;
      ctx.fillStyle = v.color || '#0284c7';
      ctx.fillRect(cabX, -halfW, cabLen, config.width);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cabX + cabLen * 0.45, -halfW + 3, 6, config.width - 6);
    } else if (v.type === 'ambulance') {
      // --- AMBULANCE (Скорая Помощь) ---
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-halfL, -halfW, config.length, config.width);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(-halfL, -halfW, config.length, config.width);

      // Red Stripe
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-halfL, -halfW + 4, config.length, 3);
      ctx.fillRect(-halfL, halfW - 7, config.length, 3);

      // Red Cross on roof
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillRect(-2, -6, 4, 12);

      // Flashing Siren Lightbar
      const flashRed = Math.floor(Date.now() / 150) % 2 === 0;
      ctx.fillStyle = flashRed ? '#ef4444' : '#3b82f6';
      ctx.fillRect(halfL * 0.1, -8, 8, 16);

      // Windshield
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(halfL * 0.45, -halfW + 3, 5, config.width - 6);
    } else if (v.type === 'police') {
      // --- POLICE INTERCEPTOR (ДПС) ---
      ctx.fillStyle = '#0f172a'; // Navy body
      ctx.fillRect(-halfL, -halfW, config.length, config.width);
      ctx.fillStyle = '#ffffff'; // White hood and roof
      ctx.fillRect(-halfL * 0.2, -halfW + 2, halfL * 0.8, config.width - 4);

      // Red/Blue Lightbar
      const flash = Math.floor(Date.now() / 150) % 2 === 0;
      ctx.fillStyle = flash ? '#ef4444' : '#3b82f6';
      ctx.fillRect(-2, -7, 6, 7);
      ctx.fillStyle = flash ? '#3b82f6' : '#ef4444';
      ctx.fillRect(-2, 0, 6, 7);

      // Windshields
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(halfL * 0.35, -halfW + 3, 5, config.width - 6);
      ctx.fillRect(-halfL * 0.55, -halfW + 3, 4, config.width - 6);
    } else {
      // --- STANDARD SEDAN / 4x4 / SPORTS / BUS ---
      ctx.fillStyle = v.color;
      ctx.fillRect(-halfL, -halfW, config.length, config.width);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-halfL, -halfW, config.length, config.width);

      // Windshield (Front & Rear)
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(halfL * 0.35, -halfW + 3, 6, config.width - 6);
      ctx.fillRect(-halfL * 0.55, -halfW + 3, 5, config.width - 6);

      // Roof
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(-halfL * 0.3, -halfW + 3, halfL * 0.65, config.width - 6);
    }

    // HEADLIGHTS & TAILLIGHTS (Physical Visual Fixtures)
    // Front Headlights
    ctx.fillStyle = v.headlights > 0 ? '#fef08a' : '#94a3b8';
    ctx.fillRect(halfL - 2, -halfW + 2, 3, 5);
    ctx.fillRect(halfL - 2, halfW - 7, 3, 5);

    // Rear Taillights / Brake Lights
    const isBraking = v.isBraking;
    ctx.fillStyle = isBraking ? '#ef4444' : '#7f1d1d';
    ctx.fillRect(-halfL - 1, -halfW + 2, 2, 5);
    ctx.fillRect(-halfL - 1, halfW - 7, 2, 5);

    // TURN SIGNALS BLINKING (Q/Z/X)
    const blinkOn = Math.floor(Date.now() / 350) % 2 === 0;
    if (blinkOn && v.turnSignal !== 'none') {
      ctx.fillStyle = '#f59e0b'; // Amber
      if (v.turnSignal === 'left' || v.turnSignal === 'hazard') {
        ctx.beginPath();
        ctx.arc(halfL - 2, -halfW + 2, 4, 0, Math.PI * 2);
        ctx.arc(-halfL + 2, -halfW + 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (v.turnSignal === 'right' || v.turnSignal === 'hazard') {
        ctx.beginPath();
        ctx.arc(halfL - 2, halfW - 2, 4, 0, Math.PI * 2);
        ctx.arc(-halfL + 2, halfW - 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (v.isCrashed) {
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-halfL - 4, -halfW - 4, config.length + 8, config.width + 8);
      ctx.setLineDash([]);
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(0, -halfW - 19);
      ctx.lineTo(10, -halfW - 4);
      ctx.lineTo(-10, -halfW - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, -halfW - 8);
    }

    // REMOTE PLAYER NAME TAG & HEALTH BAR
    if (v.isRemotePlayer && v.playerName) {
      ctx.rotate(-v.angle); // counter-rotate so text is upright
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px "JetBrains Mono", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.playerName, 0, -halfW - 14);

      // Health bar above name
      ctx.fillStyle = '#334155';
      ctx.fillRect(-20, -halfW - 10, 40, 4);
      ctx.fillStyle = v.health > 50 ? '#22c55e' : v.health > 25 ? '#eab308' : '#ef4444';
      ctx.fillRect(-20, -halfW - 10, (40 * Math.max(0, v.health)) / 100, 4);
    }

    ctx.restore();
  }

  // Render Pedestrians ("человечки") with walking animations and speech bubbles
  private renderPedestrians(ctx: CanvasRenderingContext2D, pedestrians: Pedestrian[]) {
    pedestrians.forEach((ped) => {
      if (!this.isVisible(ped.x, ped.y, 50, 50)) return;
      ctx.save();
      ctx.translate(ped.x, ped.y);
      ctx.rotate(ped.angle);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Swinging feet when walking
      const stepOffset = Math.sin(Date.now() * 0.015) * 3;
      ctx.fillStyle = ped.pantsColor;
      ctx.fillRect(-3 + stepOffset, -5, 6, 3);
      ctx.fillRect(-3 - stepOffset, 2, 6, 3);

      // Torso / Shirt
      ctx.fillStyle = ped.shirtColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head & Skin
      ctx.fillStyle = ped.skinColor;
      ctx.beginPath();
      ctx.arc(2, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      // Speech bubble if shouting
      if (ped.speechText) {
        ctx.rotate(-ped.angle); // upright text
        this.drawSpeechBubble(ctx, 0, -18, ped.speechText);
      }

      ctx.restore();
    });
  }

  // Render Player on foot
  private renderPlayerCharacter(ctx: CanvasRenderingContext2D, p: PlayerCharacter) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Walking animation feet
    const walkAnim = p.speed > 0 ? Math.sin(Date.now() * 0.02) * 5 : 0;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-4 + walkAnim, -6, 8, 4);
    ctx.fillRect(-4 - walkAnim, 2, 8, 4);

    // Torso / Trucker Vest (Orange High-Vis Vest!)
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // High-vis reflective stripes
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(-6, -4, 12, 2);
    ctx.fillRect(-6, 2, 12, 2);

    // Head with Cap
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(3, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    // Trucker Cap Visor
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(6, 0, 4, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Name tag & [E] Key hint
    ctx.rotate(-p.angle);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px "JetBrains Mono", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, 0, -22);

    ctx.fillStyle = '#eab308';
    ctx.font = '10px "JetBrains Mono", sans-serif';
    ctx.fillText('[E] Сесть в авто', 0, -10);

    ctx.restore();
  }

  // Draw Speech Bubble (as seen in screenshots!)
  private drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
    const textWidth = ctx.measureText(text).width;
    const pad = 6;
    const boxW = textWidth + pad * 2;
    const boxH = 18;

    // Bubble background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.roundRect(x - boxW / 2, y - boxH, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y - 5);
  }

  // Render Volumetric Dynamic Lighting Pass & Headlight Cones (Key Screenshot Feature!)
  private renderLightingPass(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    vehicles: VehicleInstance[],
    remotePlayers: RemotePlayer[],
    destructibles: DestructibleObject[]
  ) {
    // Daylight does not need a full-screen blend or radial lamp gradients.
    // Skipping the pass entirely avoids dozens of expensive Canvas gradients
    // every frame while preserving the lighting treatment at night.
    if (!this.isNightMode) return;

    // Determine ambient darkness (0.0 at noon, 0.78 at midnight)
    const isNight = this.isNightMode;
    const ambientDarkness = isNight ? 0.78 : 0.05;

    if (ambientDarkness > 0) {
      ctx.save();
      // Overlay dark night tint. Day remains bright, while headlights still
      // render as a subtle effect instead of washing the whole scene out.
      ctx.fillStyle = `rgba(5, 10, 20, ${ambientDarkness})`;
      ctx.fillRect(this.cameraX - canvasWidth, this.cameraY - canvasHeight, canvasWidth * 2, canvasHeight * 2);
    }

    // Screen blending avoids additive white-out when many NPC headlights
    // overlap at one junction.
    ctx.globalCompositeOperation = 'screen';

    // 1. Vehicles Headlights Cones
    vehicles.forEach((v) => {
      if (isNight && v.headlights > 0) {
        this.drawHeadlightCones(ctx, v.x, v.y, v.angle, v.type, v.headlights);
      }
    });

    // Remote Players headlights
    remotePlayers.forEach((rp) => {
      if (isNight && rp.inVehicle && rp.headlights > 0) {
        this.drawHeadlightCones(ctx, rp.x, rp.y, rp.angle, rp.vehicleType, rp.headlights);
      }
    });

    // 2. Street Lamps circular light pools
    destructibles.forEach((obj) => {
      if (obj.type === 'lamp_pole' && !obj.isDestroyed && this.isVisible(obj.x, obj.y, 180, 180)) {
        const rad = ctx.createRadialGradient(obj.x, obj.y, 5, obj.x, obj.y, 90);
        rad.addColorStop(0, 'rgba(254, 240, 138, 0.22)');
        rad.addColorStop(0.5, 'rgba(254, 240, 138, 0.07)');
        rad.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = rad;
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, 90, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    if (ambientDarkness > 0) ctx.restore();
  }

  // Draw Smooth Volumetric Dual Headlight Cones (Matching the screenshots!)
  private drawHeadlightCones(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    vehicleType: string,
    lightMode: number // 1=Low, 2=High
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const config = VEHICLE_CONFIGS[vehicleType as keyof typeof VEHICLE_CONFIGS] || VEHICLE_CONFIGS.sedan;
    const halfL = config.length / 2;
    const halfW = config.width / 2;
    const beamDistance = lightMode === 2 ? 270 : 190;
    const beamSpread = lightMode === 2 ? 0.38 : 0.28;

    const leftOriginX = halfL;
    const leftOriginY = -halfW + 3;
    const rightOriginX = halfL;
    const rightOriginY = halfW - 3;

    // Dual conical light gradient
    const drawCone = (ox: number, oy: number) => {
      const grad = ctx.createRadialGradient(ox, oy, 10, ox + beamDistance * 0.7, oy, beamDistance);
      grad.addColorStop(0, 'rgba(254, 243, 199, 0.20)');
      grad.addColorStop(0.3, 'rgba(254, 240, 138, 0.11)');
      grad.addColorStop(0.7, 'rgba(253, 230, 138, 0.035)');
      grad.addColorStop(1, 'rgba(253, 230, 138, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, beamDistance, -beamSpread, beamSpread);
      ctx.closePath();
      ctx.fill();
    };

    drawCone(leftOriginX, leftOriginY);
    drawCone(rightOriginX, rightOriginY);

    ctx.restore();
  }

  private isVisible(x: number, y: number, width: number, height: number) {
    return x + width / 2 >= this.viewBounds.left
      && x - width / 2 <= this.viewBounds.right
      && y + height / 2 >= this.viewBounds.top
      && y - height / 2 <= this.viewBounds.bottom;
  }

  private renderParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
    particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;

      if (p.type === 'splinter') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillRect(-p.size / 2, -1, p.size, 2);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
  }

  private renderTargetBeacon(ctx: CanvasRenderingContext2D, poi: PointOfInterest) {
    ctx.save();
    const pulse = Math.sin(Date.now() * 0.006) * 15;
    const radius = Math.max(poi.width, poi.height) * 0.55 + pulse;

    // Pulsing target circle
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(poi.x, poi.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Central beacon glow
    const grad = ctx.createRadialGradient(poi.x, poi.y, 5, poi.x, poi.y, radius);
    grad.addColorStop(0, 'rgba(234, 179, 8, 0.45)');
    grad.addColorStop(1, 'rgba(234, 179, 8, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  }
}
