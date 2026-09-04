import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
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
import { GameRenderer } from './renderer';
import { CityMap, WORLD_SIZE } from './cityMap';
import { VEHICLE_CONFIGS } from './vehicleConfigs';
import { nameColorForId } from './nameGenerator';

type EntityView = {
  container: Container;
  sprite?: Sprite;
  steeringWheels?: Container;
  indicator?: Sprite;
  indicatorKey?: string;
};

export type PerformanceTier = 'high' | 'balanced' | 'low';

export type RendererPerformanceStats = {
  tier: PerformanceTier;
  renderScale: number;
  p50RenderMs: number;
  p95RenderMs: number;
  activeParticles: number;
  activeSkids: number;
};

const colorNumber = (value: string | undefined, fallback = 0xffffff) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createEntityView = (layer: Container, texture?: Texture): EntityView => {
  const container = new Container();
  const sprite = texture ? new Sprite(texture) : undefined;
  sprite?.anchor.set(0.5);
  if (sprite) container.addChild(sprite);
  layer.addChild(container);
  return { container, sprite };
};

const createSteeringWheelLayer = (layer: Container) => {
  const steeringWheels = new Container();
  steeringWheels.addChild(new Graphics(), new Graphics());
  layer.addChild(steeringWheels);
  return steeringWheels;
};

/**
 * GPU renderer for the moving part of the city.
 *
 * The existing Canvas renderer is deliberately used once to produce the
 * static city snapshot. Pixi then uploads that snapshot as a GPU texture and
 * keeps all moving objects in pooled display objects. This gives us a safe,
 * incremental migration without touching the simulation or map model.
 */
export class PixiGameRenderer {
  public cameraX = 1200;
  public cameraY = 1200;
  public zoom = 1;
  public frameDelta = 1 / 60;
  public isNightMode = false;

  public readonly ready: Promise<void>;

  private readonly app = new Application();
  private readonly world = new Container();
  private readonly staticLayer = new Container();
  private readonly staticBackground = new Graphics();
  private readonly skidLayer = new Container();
  private readonly propLayer = new Container();
  private readonly vehicleLayer = new Container();
  private readonly pedestrianLayer = new Container();
  private readonly nightOverlay = new Graphics();
  private readonly lightLayer = new Container();
  private readonly particleLayer = new Container();
  private readonly beaconLayer = new Container();
  private readonly nameLabelLayer = new Container();
  private readonly speechLayer = new Container();

  private readonly vehicleViews = new Map<string, EntityView>();
  private readonly pedestrianViews = new Map<string, EntityView>();
  private readonly propViews = new Map<string, EntityView>();
  private readonly trafficLightViews = new Map<string, EntityView>();
  private readonly vehicleTextures = new Map<string, Texture>();
  private readonly pedestrianTextures = new Map<string, Texture>();
  private readonly propTextures = new Map<string, Texture>();
  private readonly trafficLightTextures = new Map<string, Texture>();
  private readonly indicatorTextures = new Map<string, Texture>();
  private readonly effectTextures = new Map<string, Texture>();
  private readonly skidSprites = new Map<string, Sprite>();
  private readonly nameLabels = new Map<string, Text>();
  private readonly nameHealthBars = new Map<string, Graphics>();
  private readonly speechBubbles = new Map<string, { bg: Graphics; text: Text }>();
  private readonly particleSprites = new Map<string, Sprite>();
  private readonly lightSprites = new Map<string, Sprite>();
  private readonly effectPool: Sprite[] = [];
  private beaconRing: Sprite | null = null;
  private beaconDot: Sprite | null = null;
  private playerCharacterTexture: Texture | null = null;
  private playerCharacterView: EntityView | null = null;
  private static readonly PLAYER_CHARACTER_LABEL_ID = 'player-character';

  private staticCanvasRenderer: GameRenderer | null = null;
  private staticTexture: Texture | null = null;
  private staticSprite: Sprite | null = null;
  private currentMap: CityMap | null = null;
  private initialized = false;
  private destroyed = false;
  private appDestroyed = false;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private pixelRatio = 1;
  private spriteResolution = 2;
  private visibleFrameProbe: boolean | null = null;
  private renderScale = 1;
  private slowFrameStreak = 0;
  private goodFrameStreak = 0;
  private performanceTier: PerformanceTier = 'high';
  private readonly renderSamples: number[] = [];

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.canvas.dataset.pixiStatus = 'initializing';
    this.ready = this.initialize();
  }

  private async initialize() {
    this.pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      window.innerWidth < 768 ? 1 : 1.5
    );
    // Sprite templates are rasterised above screen density so they stay sharp
    // when the camera zooms in; they are small, so the memory cost is tiny.
    this.spriteResolution = Math.min(3, Math.max(2, this.pixelRatio * 2));
    this.viewportWidth = canvasWidth(this.canvas);
    this.viewportHeight = canvasHeight(this.canvas);

    await this.app.init({
      canvas: this.canvas,
      width: this.viewportWidth,
      height: this.viewportHeight,
      resolution: this.pixelRatio,
      autoDensity: true,
      autoStart: false,
      antialias: false,
      // Keep the clear color distinct from the static-world green so the
      // one-time framebuffer health probe can detect a blank WebGL surface.
      backgroundColor: 0x000000,
      preference: 'webgl',
      webgl: {
        preferWebGLVersion: 2,
        // The scene uses no advanced blend modes, so the back buffer would only
        // add a full-screen copy of every frame.
        useBackBuffer: false,
        powerPreference: 'high-performance',
      },
    });

    if (this.destroyed) {
      this.disposeApplication();
      return;
    }

    // Order matches the Canvas renderer's own draw sequence: vehicles and
    // pedestrians sit under the night overlay so they actually dim after
    // dark, and the headlight/lamp glow layer draws last, in 'screen' blend
    // mode, so lights still visibly punch through that darkness on top.
    this.world.addChild(
      this.staticLayer,
      this.skidLayer,
      this.propLayer,
      this.vehicleLayer,
      this.pedestrianLayer,
      this.nightOverlay,
      this.lightLayer,
      this.particleLayer,
      this.nameLabelLayer,
      this.speechLayer,
      this.beaconLayer
    );
    this.lightLayer.blendMode = 'screen';
    this.staticBackground.rect(0, 0, WORLD_SIZE, WORLD_SIZE).fill(0x0f3822);
    this.staticLayer.addChildAt(this.staticBackground, 0);
    this.app.stage.addChild(this.world);
    this.initialized = true;
    this.canvas.dataset.pixiStatus = 'ready';
    this.resize(this.viewportWidth, this.viewportHeight);
  }

  public resize(width: number, height: number) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    if (this.initialized && !this.destroyed) {
      this.app.renderer.resize(
        this.viewportWidth,
        this.viewportHeight,
        this.pixelRatio * this.renderScale
      );
    }
  }

  public setZoom(value: number) {
    this.zoom = value;
  }

  public setNightMode(value: boolean) {
    this.isNightMode = value;
  }

  /**
   * A renderer can initialize successfully while the browser's WebGL
   * surface still produces an empty framebuffer. The app uses this one-time
   * probe to switch to the preserved Canvas surface in that case.
   */
  public hasVisibleFrame() {
    if (this.destroyed || !this.initialized) return false;
    // Only report a blank surface once the probe below has actually run
    // immediately after a draw call; a readPixels outside that window reads an
    // undefined drawing buffer and would drop a healthy GPU to Canvas.
    return this.visibleFrameProbe !== false;
  }

  private probeVisibleFrame() {
    if (this.visibleFrameProbe !== null) return;
    const gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
    if (!gl) return;
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(this.canvas.width / 2),
      Math.floor(this.canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel
    );
    this.visibleFrameProbe = pixel[0] + pixel[1] + pixel[2] > 0;
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
    if (!this.initialized || this.destroyed) return;

    const renderStarted = performance.now();

    const focusX = inVehicle && playerVehicle ? playerVehicle.x : playerChar.x;
    const focusY = inVehicle && playerVehicle ? playerVehicle.y : playerChar.y;
    const frameDelta = Math.min(Math.max(this.frameDelta, 1 / 120), 0.05);
    const follow = 1 - Math.exp(-9 * frameDelta);
    this.cameraX += (focusX - this.cameraX) * follow;
    this.cameraY += (focusY - this.cameraY) * follow;

    if (this.currentMap !== cityMap) this.rebuildStaticScene(cityMap);

    const width = canvasWidth || this.viewportWidth;
    const height = canvasHeight || this.viewportHeight;
    this.world.scale.set(this.zoom);
    this.world.position.set(
      width / 2 - this.cameraX * this.zoom,
      height / 2 - this.cameraY * this.zoom
    );

    const bounds = {
      left: this.cameraX - width / (2 * this.zoom) - 160,
      top: this.cameraY - height / (2 * this.zoom) - 160,
      right: this.cameraX + width / (2 * this.zoom) + 160,
      bottom: this.cameraY + height / (2 * this.zoom) + 160,
    };

    this.renderSkidMarks(skidMarks, bounds);
    this.renderProps(destructibles, bounds);
    this.renderTrafficLights(cityMap.trafficLights, bounds);
    // The player's own vehicle keeps existing in the world after they step
    // out of it — it stays parked where they left it, not vanish — so it
    // renders regardless of inVehicle, same as any other vehicle.
    const ownVehicle = playerVehicle ? [playerVehicle] : [];
    this.renderVehicles(trafficCars, ownVehicle, remotePlayers, bounds);
    this.renderPedestrians(pedestrians, bounds);
    if (!inVehicle) {
      this.renderPlayerCharacter(playerChar, bounds);
    } else {
      this.hidePlayerCharacter();
    }
    this.renderNightOverlay(bounds);
    this.renderLighting(trafficCars, ownVehicle, remotePlayers, destructibles, bounds);
    this.renderParticles(particles, bounds);
    this.renderBeacon(targetPoi, bounds);
    // Drive Pixi directly from the existing game loop. This avoids relying on
    // the TickerPlugin and is the documented manual-render path for v8.
    this.app.renderer.render(this.app.stage);
    this.probeVisibleFrame();
    this.canvas.dataset.pixiStatus = 'rendered';
    const renderMs = performance.now() - renderStarted;
    this.recordRenderSample(renderMs);
    this.adjustResolution(renderMs);
  }

  private adjustResolution(frameTimeMs: number) {
    if (frameTimeMs > 20) {
      this.slowFrameStreak += 1;
      this.goodFrameStreak = 0;
    } else if (frameTimeMs < 12) {
      this.goodFrameStreak += 1;
      this.slowFrameStreak = 0;
    } else {
      this.slowFrameStreak = 0;
      this.goodFrameStreak = 0;
    }

    if (this.slowFrameStreak >= 8 && this.renderScale > 0.8) {
      this.renderScale = Math.max(0.8, this.renderScale - 0.1);
      this.slowFrameStreak = 0;
      this.resize(this.viewportWidth, this.viewportHeight);
    } else if (this.goodFrameStreak >= 120 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.1);
      this.goodFrameStreak = 0;
      this.resize(this.viewportWidth, this.viewportHeight);
    }
    this.performanceTier = this.renderScale <= 0.8 ? 'low' : this.renderScale < 1 ? 'balanced' : 'high';
  }

  private recordRenderSample(renderMs: number) {
    this.renderSamples.push(renderMs);
    if (this.renderSamples.length > 120) this.renderSamples.shift();
  }

  public getPerformanceStats(): RendererPerformanceStats {
    const sorted = [...this.renderSamples].sort((a, b) => a - b);
    const at = (percentile: number) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
    return {
      tier: this.performanceTier,
      renderScale: this.renderScale,
      p50RenderMs: at(0.5),
      p95RenderMs: at(0.95),
      activeParticles: this.particleSprites.size,
      activeSkids: this.skidSprites.size,
    };
  }

  private effectLimit(kind: 'particles' | 'skids') {
    if (this.performanceTier === 'low') return kind === 'particles' ? 120 : 160;
    if (this.performanceTier === 'balanced') return kind === 'particles' ? 260 : 320;
    return kind === 'particles' ? 500 : 500;
  }

  private maxTextureSize() {
    const gl = (this.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
    const reported = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
    return typeof reported === 'number' && reported > 0 ? reported : 2048;
  }

  private rebuildStaticScene(cityMap: CityMap) {
    this.currentMap = cityMap;
    if (!this.staticCanvasRenderer) {
      const snapshotCanvas = document.createElement('canvas');
      const snapshotContext = snapshotCanvas.getContext('2d');
      if (!snapshotContext) return;
      this.staticCanvasRenderer = new GameRenderer(snapshotContext);
    }

    // Render the city snapshot at screen density instead of one texel per world
    // unit. Anything less is upscaled by the camera and reads as a blurred map.
    // The budget caps VRAM: 4096px is ~67MB, still 2x the old 2048px snapshot.
    const budget = window.innerWidth < 768 ? 2560 : 4096;
    const maxScale = Math.min(this.maxTextureSize(), budget) / WORLD_SIZE;
    const scale = Math.max(0.5, Math.min(this.pixelRatio, maxScale));
    this.staticCanvasRenderer.setStaticSceneScale(scale);

    const snapshot = this.staticCanvasRenderer.getStaticScene(cityMap);
    if (!snapshot) return;

    try {
      if (this.staticSprite) {
        this.staticLayer.removeChild(this.staticSprite);
        this.staticSprite.destroy();
      }
      this.staticTexture?.destroy(true);
      this.staticTexture = Texture.from(snapshot);
      this.staticSprite = new Sprite(this.staticTexture);
      this.staticSprite.position.set(0, 0);
      // The snapshot is in scaled pixels; map it back onto world coordinates.
      this.staticSprite.scale.set(WORLD_SIZE / snapshot.width, WORLD_SIZE / snapshot.height);
      this.staticLayer.addChild(this.staticSprite);
    } catch (error) {
      console.error('Pixi static scene upload failed; continuing with dynamic GPU layers.', error);
    }
  }

  private renderSkidMarks(skids: SkidMark[], bounds: Bounds) {
    const active = new Set<string>();
    let rendered = 0;
    for (let index = 0; index < skids.length; index += 1) {
      if (rendered >= this.effectLimit('skids')) break;
      const skid = skids[index];
      if (!lineVisible(skid.x1, skid.y1, skid.x2, skid.y2, bounds)) continue;
      const id = `${index}:${skid.x1}:${skid.y1}`;
      const sprite = this.acquireEffectSprite(this.skidSprites, id, this.skidLayer, this.getEffectTexture('skid'));
      active.add(id);
      const dx = skid.x2 - skid.x1;
      const dy = skid.y2 - skid.y1;
      sprite.visible = true;
      sprite.position.set((skid.x1 + skid.x2) * 0.5, (skid.y1 + skid.y2) * 0.5);
      sprite.rotation = Math.atan2(dy, dx);
      sprite.alpha = skid.alpha;
      sprite.scale.set(Math.max(0.01, Math.hypot(dx, dy) / 16), Math.max(0.01, skid.width / 2));
      rendered += 1;
    }
    this.releaseEffects(this.skidSprites, active);
  }

  private renderProps(props: DestructibleObject[], bounds: Bounds) {
    const active = new Set<string>();
    for (const prop of props) {
      const view = this.getView(this.propViews, prop.id, this.propLayer, this.getPropTexture(prop));
      view.container.visible = !prop.isDestroyed && this.isVisible(prop.x, prop.y, prop.width + 24, prop.height + 24, bounds);
      if (!view.container.visible) continue;
      active.add(prop.id);
      view.container.position.set(prop.x, prop.y);
      view.container.rotation = prop.angle;
      if (view.sprite) view.sprite.texture = this.getPropTexture(prop);
    }
    this.hideInactive(this.propViews, active);
  }

  private renderTrafficLights(lights: TrafficLight[], bounds: Bounds) {
    const active = new Set<string>();
    for (const light of lights) {
      const view = this.getView(this.trafficLightViews, light.id, this.lightLayer, this.getTrafficLightTexture(light));
      view.container.visible = this.isVisible(light.x, light.y, 30, 30, bounds);
      if (!view.container.visible) continue;
      active.add(light.id);
      view.container.position.set(light.x, light.y);
      if (view.sprite) view.sprite.texture = this.getTrafficLightTexture(light);
    }
    this.hideInactive(this.trafficLightViews, active);
  }

  private renderVehicles(
    npcVehicles: VehicleInstance[],
    playerVehicles: VehicleInstance[],
    remotePlayers: RemotePlayer[],
    bounds: Bounds
  ) {
    const active = new Set<string>();
    const activeLabels = new Set<string>();
    for (const vehicle of [...npcVehicles, ...playerVehicles]) {
      active.add(vehicle.id);
      this.updateVehicleView(
        this.getView(this.vehicleViews, vehicle.id, this.vehicleLayer, this.getVehicleTexture(vehicle)),
        vehicle,
        bounds
      );
    }
    for (const remote of remotePlayers) {
      if (!remote.inVehicle) continue;
      const dummy: VehicleInstance = {
        id: `remote_${remote.id}`,
        type: remote.vehicleType,
        x: remote.x,
        y: remote.y,
        angle: remote.angle,
        speed: remote.speed,
        steeringAngle: remote.steering,
        angularVelocity: 0,
        color: remote.vehicleColor,
        health: remote.condition,
        maxHealth: 100,
        headlights: remote.headlights,
        turnSignal: remote.turnSignal as VehicleInstance['turnSignal'],
        isBraking: false,
        isReversing: false,
        isHonking: remote.isHonking,
        isSiren: remote.isSiren,
        isPlayer: false,
        isRemotePlayer: true,
        playerName: remote.name,
        smokeTimer: 0,
      };
      active.add(dummy.id);
      this.updateVehicleView(
        this.getView(this.vehicleViews, dummy.id, this.vehicleLayer, this.getVehicleTexture(dummy)),
        dummy,
        bounds
      );
      activeLabels.add(remote.id);
      this.updateNameLabel(remote, bounds);
    }
    this.hideInactive(this.vehicleViews, active);
    this.releaseNameLabels(activeLabels);
  }

  private updateNameLabel(remote: RemotePlayer, bounds: Bounds) {
    if (!this.isVisible(remote.x, remote.y, 140, 140, bounds)) {
      const existing = this.nameLabels.get(remote.id);
      if (existing) existing.visible = false;
      const existingBar = this.nameHealthBars.get(remote.id);
      if (existingBar) existingBar.visible = false;
      return;
    }
    let label = this.nameLabels.get(remote.id);
    if (!label) {
      label = new Text({
        text: remote.name,
        style: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13,
          fontWeight: 'bold',
          fill: nameColorForId(remote.id),
          stroke: { color: 0x0f172a, width: 3 },
        },
        resolution: this.spriteResolution,
      });
      label.anchor.set(0.5, 1);
      this.nameLabelLayer.addChild(label);
      this.nameLabels.set(remote.id, label);
    } else if (label.text !== remote.name) {
      label.text = remote.name;
    }
    label.visible = true;
    const config = VEHICLE_CONFIGS[remote.vehicleType] || VEHICLE_CONFIGS.sedan;
    label.position.set(remote.x, remote.y - config.width / 2 - 14);

    // The Canvas renderer draws a health bar above every remote player's
    // name tag; this GPU path only ever drew the name.
    let bar = this.nameHealthBars.get(remote.id);
    if (!bar) {
      bar = new Graphics();
      this.nameLabelLayer.addChild(bar);
      this.nameHealthBars.set(remote.id, bar);
    }
    bar.visible = true;
    bar.position.set(remote.x - 20, remote.y - config.width / 2 - 10);
    bar.clear();
    bar.rect(0, 0, 40, 4).fill(0x334155);
    const health = Math.max(0, remote.condition);
    const healthColor = health > 50 ? 0x22c55e : health > 25 ? 0xeab308 : 0xef4444;
    bar.rect(0, 0, (40 * health) / 100, 4).fill(healthColor);
  }

  private releaseNameLabels(active: Set<string>) {
    for (const [id, label] of this.nameLabels) {
      if (active.has(id)) continue;
      this.nameLabels.delete(id);
      this.nameLabelLayer.removeChild(label);
      label.destroy();
    }
    for (const [id, bar] of this.nameHealthBars) {
      if (active.has(id)) continue;
      this.nameHealthBars.delete(id);
      this.nameLabelLayer.removeChild(bar);
      bar.destroy();
    }
  }

  private updateVehicleView(view: EntityView, vehicle: VehicleInstance, bounds: Bounds) {
    view.container.visible = this.isVisible(vehicle.x, vehicle.y, 110, 110, bounds);
    if (!view.container.visible) return;
    view.container.position.set(vehicle.x, vehicle.y);
    view.container.rotation = vehicle.angle;
    if (view.sprite) view.sprite.texture = this.getVehicleTexture(vehicle);
    if (!view.steeringWheels) view.steeringWheels = createSteeringWheelLayer(view.container);
    this.updateSteeringWheels(view.steeringWheels, vehicle);
    const indicatorKey = `${vehicle.type}:${vehicle.headlights}:${vehicle.isBraking}:${vehicle.turnSignal}:${vehicle.isCrashed ? 1 : 0}:${Math.floor(Date.now() / 350) % 2}:${Math.floor(Date.now() / 150) % 2}`;
    if (!view.indicator) {
      view.indicator = new Sprite(this.getVehicleIndicatorTexture(vehicle));
      view.indicator.anchor.set(0.5);
      view.container.addChild(view.indicator);
      view.indicatorKey = indicatorKey;
    } else if (view.indicatorKey !== indicatorKey) {
      view.indicator.texture = this.getVehicleIndicatorTexture(vehicle);
      view.indicatorKey = indicatorKey;
    }
  }

  private updateSteeringWheels(layer: Container, vehicle: VehicleInstance) {
    const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan;
    const frontAxleX = (config.length / 2) * 0.65;
    const halfWidth = config.width / 2;
    const wheels = layer.children as Graphics[];
    for (const [index, wheel] of wheels.entries()) {
      wheel.clear();
      wheel.rect(-5, -2, 10, 4).fill(0x090d16);
      wheel.position.set(frontAxleX, index === 0 ? -halfWidth - 1 : halfWidth + 1);
      wheel.rotation = vehicle.steeringAngle;
    }
  }

  /**
   * The Canvas renderer darkens the whole scene at night (a full-screen
   * rgba(5,10,20,0.78) overlay) before drawing headlights/lamp glows in
   * 'screen' blend mode on top, so lights visibly punch through the dark.
   * This GPU path never drew that overlay at all — headlights and street
   * lamps just floated over a scene that stayed fully daylight-bright.
   */
  private renderNightOverlay(bounds: Bounds) {
    this.nightOverlay.clear();
    if (!this.isNightMode) {
      this.nightOverlay.visible = false;
      return;
    }
    this.nightOverlay.visible = true;
    this.nightOverlay
      .rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
      .fill({ color: 0x050a14, alpha: 0.78 });
  }

  /**
   * The Canvas renderer has always drawn the on-foot player (a trucker
   * figure + name tag), but this GPU path never did — stepping out of the
   * vehicle just left nothing on screen. Mirrors the vehicle/pedestrian
   * pooled-sprite pattern above instead of the Canvas immediate-mode draw.
   */
  private renderPlayerCharacter(playerChar: PlayerCharacter, bounds: Bounds) {
    if (!this.isVisible(playerChar.x, playerChar.y, 40, 40, bounds)) {
      this.hidePlayerCharacter();
      return;
    }
    if (!this.playerCharacterView) {
      this.playerCharacterView = createEntityView(this.pedestrianLayer, this.getPlayerCharacterTexture());
    }
    const view = this.playerCharacterView;
    view.container.visible = true;
    view.container.position.set(playerChar.x, playerChar.y);
    view.container.rotation = playerChar.angle;

    let label = this.nameLabels.get(PixiGameRenderer.PLAYER_CHARACTER_LABEL_ID);
    if (!label) {
      label = new Text({
        text: playerChar.name,
        style: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12,
          fontWeight: 'bold',
          fill: 0x38bdf8,
          stroke: { color: 0x0f172a, width: 3 },
        },
        resolution: this.spriteResolution,
      });
      label.anchor.set(0.5, 1);
      this.nameLabelLayer.addChild(label);
      this.nameLabels.set(PixiGameRenderer.PLAYER_CHARACTER_LABEL_ID, label);
    } else if (label.text !== playerChar.name) {
      label.text = playerChar.name;
    }
    label.visible = true;
    label.position.set(playerChar.x, playerChar.y - 20);
  }

  private hidePlayerCharacter() {
    if (this.playerCharacterView) this.playerCharacterView.container.visible = false;
    const label = this.nameLabels.get(PixiGameRenderer.PLAYER_CHARACTER_LABEL_ID);
    if (label) label.visible = false;
  }

  private getPlayerCharacterTexture() {
    if (this.playerCharacterTexture) return this.playerCharacterTexture;
    const template = new Graphics();
    template.ellipse(0, 0, 9, 6).fill({ color: 0x000000, alpha: 0.4 });
    template.ellipse(0, 0, 8, 6).fill(0xf97316); // High-vis vest
    template.rect(-6, -4, 12, 2).fill(0xfef08a); // Reflective stripes
    template.rect(-6, 2, 12, 2).fill(0xfef08a);
    template.circle(3, 0, 5).fill(0xfed7ac); // Head
    template.arc(6, 0, 4, -Math.PI / 2, Math.PI / 2).fill(0x0284c7); // Cap visor
    this.playerCharacterTexture = this.generateSpriteTexture(template);
    template.destroy();
    return this.playerCharacterTexture;
  }

  private renderPedestrians(pedestrians: Pedestrian[], bounds: Bounds) {
    const active = new Set<string>();
    const activeSpeech = new Set<string>();
    for (const ped of pedestrians) {
      const view = this.getView(this.pedestrianViews, ped.id, this.pedestrianLayer, this.getPedestrianTexture(ped));
      view.container.visible = ped.state !== 'indoors' && this.isVisible(ped.x, ped.y, 50, 50, bounds);
      if (!view.container.visible) continue;
      active.add(ped.id);
      view.container.position.set(ped.x, ped.y);
      // Pedestrian textures face up in local coordinates, while simulation
      // angles point along +X. The missing quarter turn made walkers appear
      // to travel sideways.
      view.container.rotation = ped.angle + Math.PI / 2;
      if (view.sprite) view.sprite.texture = this.getPedestrianTexture(ped);
      if (ped.speechText) {
        activeSpeech.add(ped.id);
        this.updateSpeechBubble(ped.id, ped.x, ped.y, ped.speechText);
      }
    }
    this.hideInactive(this.pedestrianViews, active);
    this.releaseSpeechBubbles(activeSpeech);
  }

  /**
   * The Canvas renderer shows a speech bubble whenever a pedestrian has
   * reactive dialogue (ped.speechText) — this GPU path never read that
   * field at all, so pedestrian reactions were silently invisible.
   */
  private updateSpeechBubble(id: string, x: number, y: number, text: string) {
    let bubble = this.speechBubbles.get(id);
    if (!bubble) {
      const bg = new Graphics();
      const label = new Text({
        text,
        style: {
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontSize: 11,
          fontWeight: 'bold',
          fill: 0xf8fafc,
        },
        resolution: this.spriteResolution,
      });
      label.anchor.set(0.5, 1);
      this.speechLayer.addChild(bg, label);
      bubble = { bg, text: label };
      this.speechBubbles.set(id, bubble);
    } else if (bubble.text.text !== text) {
      bubble.text.text = text;
    }
    bubble.bg.visible = true;
    bubble.text.visible = true;
    const padX = 6;
    const boxH = 18;
    const boxW = bubble.text.width + padX * 2;
    bubble.text.position.set(x, y - 23);
    bubble.bg.clear();
    bubble.bg
      .roundRect(x - boxW / 2, y - 18 - boxH, boxW, boxH, 6)
      .fill({ color: 0x0f172a, alpha: 0.92 })
      .stroke({ color: 0x64748b, width: 1.5 });
  }

  private releaseSpeechBubbles(active: Set<string>) {
    for (const [id, bubble] of this.speechBubbles) {
      if (active.has(id)) continue;
      bubble.bg.visible = false;
      bubble.text.visible = false;
    }
  }

  private renderLighting(
    npcVehicles: VehicleInstance[],
    playerVehicles: VehicleInstance[],
    remotePlayers: RemotePlayer[],
    props: DestructibleObject[],
    bounds: Bounds
  ) {
    const active = new Set<string>();
    if (!this.isNightMode) {
      this.releaseEffects(this.lightSprites, active);
      return;
    }

    for (const vehicle of [...npcVehicles, ...playerVehicles]) {
      if (!vehicle.headlights || !this.isVisible(vehicle.x, vehicle.y, 360, 360, bounds)) continue;
      const sprite = this.acquireEffectSprite(this.lightSprites, `headlight:${vehicle.id}`, this.lightLayer, this.getEffectTexture(vehicle.headlights === 2 ? 'headlight-high' : 'headlight-low'));
      active.add(`headlight:${vehicle.id}`);
      sprite.visible = true;
      sprite.position.set(vehicle.x, vehicle.y);
      sprite.rotation = vehicle.angle;
      sprite.alpha = 0.55;
    }
    for (const remote of remotePlayers) {
      if (!remote.inVehicle || !remote.headlights || !this.isVisible(remote.x, remote.y, 360, 360, bounds)) continue;
      const id = `headlight:remote:${remote.id}`;
      const sprite = this.acquireEffectSprite(this.lightSprites, id, this.lightLayer, this.getEffectTexture(remote.headlights === 2 ? 'headlight-high' : 'headlight-low'));
      active.add(id);
      sprite.visible = true;
      sprite.position.set(remote.x, remote.y);
      sprite.rotation = remote.angle;
      sprite.alpha = 0.55;
    }
    for (const prop of props) {
      if (prop.type !== 'lamp_pole' || prop.isDestroyed || !this.isVisible(prop.x, prop.y, 180, 180, bounds)) continue;
      const id = `lamp:${prop.id}`;
      const sprite = this.acquireEffectSprite(this.lightSprites, id, this.lightLayer, this.getEffectTexture('lamp'));
      active.add(id);
      sprite.visible = true;
      sprite.position.set(prop.x, prop.y);
      sprite.alpha = 0.12;
    }
    this.releaseEffects(this.lightSprites, active);
  }

  private renderParticles(particles: Particle[], bounds: Bounds) {
    const active = new Set<string>();
    let rendered = 0;
    for (const particle of particles) {
      if (rendered >= this.effectLimit('particles')) break;
      if (!this.isVisible(particle.x, particle.y, particle.size * 2 + 8, particle.size * 2 + 8, bounds)) continue;
      const sprite = this.acquireEffectSprite(this.particleSprites, particle.id, this.particleLayer, this.getEffectTexture(particle.type === 'splinter' ? 'splinter' : 'particle'));
      active.add(particle.id);
      sprite.visible = true;
      sprite.position.set(particle.x, particle.y);
      sprite.rotation = particle.angle || 0;
      sprite.tint = colorNumber(particle.color);
      sprite.alpha = particle.alpha;
      const size = Math.max(1, particle.size);
      sprite.scale.set(particle.type === 'splinter' ? size / 12 : size / 8, particle.type === 'splinter' ? 1 : size / 8);
      rendered += 1;
    }
    this.releaseEffects(this.particleSprites, active);
  }

  private renderBeacon(poi: PointOfInterest | null, bounds: Bounds) {
    if (!poi || !this.isVisible(poi.x, poi.y, poi.width, poi.height, bounds)) {
      if (this.beaconRing) this.beaconRing.visible = false;
      if (this.beaconDot) this.beaconDot.visible = false;
      return;
    }
    if (!this.beaconRing) {
      this.beaconRing = new Sprite(this.getEffectTexture('beacon-ring'));
      this.beaconRing.anchor.set(0.5);
      this.beaconLayer.addChild(this.beaconRing);
      this.beaconDot = new Sprite(this.getEffectTexture('beacon-dot'));
      this.beaconDot.anchor.set(0.5);
      this.beaconLayer.addChild(this.beaconDot);
    }
    const pulse = 34 + Math.sin(performance.now() * 0.006) * 8;
    this.beaconRing.visible = true;
    this.beaconRing.position.set(poi.x, poi.y);
    this.beaconRing.scale.set(pulse / 40);
    this.beaconDot!.visible = true;
    this.beaconDot!.position.set(poi.x, poi.y);
  }

  private drawProp(graphics: Graphics, prop: DestructibleObject) {
    graphics.clear();
    if (prop.type === 'crate') {
      graphics.rect(-prop.width / 2, -prop.height / 2, prop.width, prop.height).fill(0xb45309).stroke({ color: 0x78350f, width: 2 });
      graphics.moveTo(-prop.width / 2, -prop.height / 2).lineTo(prop.width / 2, prop.height / 2).stroke({ color: 0x78350f, width: 2 });
      graphics.moveTo(prop.width / 2, -prop.height / 2).lineTo(-prop.width / 2, prop.height / 2).stroke({ color: 0x78350f, width: 2 });
    } else if (prop.type === 'fence') {
      graphics.rect(-prop.width / 2, -3, prop.width, 6).fill(0xe2e8f0);
      graphics.rect(-prop.width / 2, -5, 6, 10).fill(0x475569);
      graphics.rect(prop.width / 2 - 6, -5, 6, 10).fill(0x475569);
    } else if (prop.type === 'lamp_pole') {
      graphics.circle(0, 0, 6).fill(0x475569);
      graphics.circle(0, 0, 3).fill(0xfef08a);
    } else {
      const color = prop.type === 'cone' ? 0xea580c : prop.type === 'hydrant' ? 0xdc2626 : prop.type === 'barrel' ? 0x0284c7 : 0x1e293b;
      graphics.circle(0, 0, prop.type === 'trash_can' ? 6 : 7).fill(color);
    }
  }

  private drawTrafficLight(graphics: Graphics, light: TrafficLight) {
    graphics.clear();
    graphics.rect(-5, -14, 10, 28).fill(0x0f172a).stroke({ color: 0x334155, width: 1.5 });
    graphics.circle(0, -9, 3.5).fill(light.state === 'red' ? 0xef4444 : 0x450a0a);
    graphics.circle(0, 0, 3.5).fill(light.state === 'yellow' ? 0xeab308 : 0x422006);
    graphics.circle(0, 9, 3.5).fill(light.state === 'green' ? 0x22c55e : 0x052e16);
    graphics.rect(6, -4, 5, 8).fill(light.pedestrianState === 'walk' ? 0x22c55e : 0xef4444);
  }

  private drawVehicle(graphics: Graphics, vehicle: VehicleInstance) {
    const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan;
    const halfLength = config.length / 2;
    const halfWidth = config.width / 2;
    const body = colorNumber(vehicle.color, 0x64748b);
    graphics.clear();

    const wheelColor = 0x111827;
    graphics.rect(-halfLength * 0.58, -halfWidth - 3, 12, 6).fill(wheelColor);
    graphics.rect(-halfLength * 0.58, halfWidth - 3, 12, 6).fill(wheelColor);

    // Each class gets one strong top-down cue that survives the normal game
    // zoom. The scene is too dense for fussy detail: silhouette and livery
    // must identify a vehicle before its colour does.
    if (vehicle.type === 'ambulance') {
      graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(0xffffff).stroke({ color: 0xe2e8f0, width: 1.5 });
      graphics.rect(-halfLength, -halfWidth + 4, config.length, 3).fill(0xdc2626);
      graphics.rect(-halfLength, halfWidth - 7, config.length, 3).fill(0xdc2626);
      graphics.rect(-6, -2, 12, 4).fill(0xdc2626);
      graphics.rect(-2, -6, 4, 12).fill(0xdc2626);
      graphics.rect(halfLength * 0.45, -halfWidth + 3, 5, config.width - 6).fill(0x0284c7);
    } else if (vehicle.type === 'police') {
      graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(0x0f172a);
      graphics.rect(-halfLength * 0.2, -halfWidth + 2, halfLength * 0.8, config.width - 4).fill(0xffffff);
      graphics.rect(halfLength * 0.35, -halfWidth + 3, 5, config.width - 6).fill(0x0284c7);
      graphics.rect(-halfLength * 0.55, -halfWidth + 3, 4, config.width - 6).fill(0x0284c7);
    } else if (vehicle.type === 'kamaz_dump') {
      // Raised ribbed tipper body and a separate cab make the KAMAZ readable
      // as working machinery rather than a long orange sedan.
      graphics.rect(-halfLength, -halfWidth + 3, halfLength * 1.15, config.width - 6).fill(0xd97706).stroke({ color: 0x78350f, width: 2 });
      graphics.rect(-halfLength * 0.85, -halfWidth + 6, halfLength * 0.78, config.width - 12).fill(0x92400e);
      for (let rib = 0; rib < 3; rib += 1) {
        graphics.rect(-halfLength * 0.7 + rib * halfLength * 0.24, -halfWidth + 5, 3, config.width - 10).fill(0xfbbf24);
      }
      graphics.rect(halfLength * 0.2, -halfWidth, halfLength * 0.8, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
      graphics.rect(halfLength * 0.5, -halfWidth + 4, halfLength * 0.22, config.width - 8).fill(0x7dd3fc);
    } else if (vehicle.type === 'kamaz_flatbed') {
      // Open rails and boxed cargo distinguish the flatbed from a dump body.
      graphics.rect(-halfLength, -halfWidth + 4, halfLength * 1.16, config.width - 8).fill(0x075985).stroke({ color: 0x0c4a6e, width: 2 });
      graphics.rect(-halfLength * 0.92, -halfWidth + 6, halfLength * 0.85, 3).fill(0xe2e8f0);
      graphics.rect(-halfLength * 0.92, halfWidth - 9, halfLength * 0.85, 3).fill(0xe2e8f0);
      graphics.rect(-halfLength * 0.7, -halfWidth + 9, 15, config.width - 18).fill(0x94a3b8);
      graphics.rect(-halfLength * 0.3, -halfWidth + 9, 15, config.width - 18).fill(0xf59e0b);
      graphics.rect(halfLength * 0.2, -halfWidth, halfLength * 0.8, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
      graphics.rect(halfLength * 0.5, -halfWidth + 4, halfLength * 0.22, config.width - 8).fill(0x7dd3fc);
    } else if (vehicle.type === 'bus') {
      graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
      graphics.rect(-halfLength * 0.78, -halfWidth + 4, halfLength * 1.45, 4).fill(0xbfe9ff);
      graphics.rect(-halfLength * 0.78, halfWidth - 8, halfLength * 1.45, 4).fill(0xbfe9ff);
      graphics.rect(-5, -halfWidth + 3, 7, config.width - 6).fill(0xf8fafc);
      graphics.rect(-halfLength * 0.45, -5, 11, 10).fill(0x0f172a);
    } else if (vehicle.type === 'taxi') {
      graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
      for (let mark = 0; mark < 4; mark += 1) {
        graphics.rect(-halfLength * 0.48 + mark * 6, -halfWidth + 2, 4, 4).fill(mark % 2 === 0 ? 0x111827 : 0xf8fafc);
        graphics.rect(-halfLength * 0.48 + mark * 6, halfWidth - 6, 4, 4).fill(mark % 2 === 0 ? 0x111827 : 0xf8fafc);
      }
      graphics.rect(-2, -5, 9, 10).fill(0xf8fafc).stroke({ color: 0x111827, width: 1.5 });
      graphics.rect(halfLength * 0.22, -halfWidth + 3, halfLength * 0.3, config.width - 6).fill(0x7dd3fc);
    } else if (vehicle.type === 'sports') {
      graphics.poly([-halfLength, -halfWidth * 0.58, -halfLength * 0.62, -halfWidth, halfLength * 0.76, -halfWidth, halfLength, 0, halfLength * 0.76, halfWidth, -halfLength * 0.62, halfWidth, -halfLength, halfWidth * 0.58]).fill(body).stroke({ color: 0x0f172a, width: 2 });
      graphics.poly([-halfLength * 0.22, -halfWidth + 3, halfLength * 0.48, -halfWidth + 3, halfLength * 0.62, 0, halfLength * 0.48, halfWidth - 3, -halfLength * 0.22, halfWidth - 3]).fill(0x7dd3fc);
      graphics.rect(-halfLength * 0.9, -halfWidth - 3, 8, 2).fill(0x111827);
      graphics.rect(-halfLength * 0.9, halfWidth + 1, 8, 2).fill(0x111827);
    } else if (vehicle.type === 'hatchback') {
      graphics.poly([-halfLength * 0.8, -halfWidth, halfLength, -halfWidth, halfLength, halfWidth, -halfLength * 0.8, halfWidth, -halfLength, halfWidth * 0.48, -halfLength, -halfWidth * 0.48]).fill(body).stroke({ color: 0x0f172a, width: 2 });
      graphics.rect(-halfLength * 0.16, -halfWidth + 3, halfLength * 0.45, config.width - 6).fill(0x7dd3fc);
      graphics.rect(-halfLength * 0.82, -halfWidth + 4, 5, config.width - 8).fill(0x475569);
    } else if (vehicle.type === 'heavy_4x4') {
      graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
      graphics.rect(-halfLength * 0.82, -halfWidth - 2, 16, 4).fill(0x111827);
      graphics.rect(-halfLength * 0.82, halfWidth - 2, 16, 4).fill(0x111827);
      graphics.rect(-halfLength * 0.72, -halfWidth + 5, halfLength * 0.54, config.width - 10).fill(0x334155);
      graphics.rect(halfLength * 0.08, -halfWidth + 3, halfLength * 0.42, config.width - 6).fill(0x7dd3fc);
    } else {
      graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2, alpha: 0.75 });
      graphics.rect(-halfLength * 0.1, -halfWidth + 3, halfLength * 0.42, config.width - 6).fill(0x7dd3fc);
      graphics.rect(-halfLength * 0.62, -halfWidth + 5, halfLength * 0.28, config.width - 10).fill(0x94a3b8);
    }
    // The flashing lightbar is dynamic (it alternates color on a timer) so it
    // belongs on the indicator overlay in drawVehicleIndicators, not on this
    // cached-per-type-and-color body texture.
    graphics.rect(halfLength - 4, -halfWidth + 2, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
    graphics.rect(halfLength - 4, halfWidth - 7, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
    graphics.rect(-halfLength - 1, -halfWidth + 2, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);
    graphics.rect(-halfLength - 1, halfWidth - 7, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);

    if (vehicle.turnSignal !== 'none' && Math.floor(Date.now() / 350) % 2 === 0) {
      const signal = 0xf59e0b;
      if (vehicle.turnSignal === 'left' || vehicle.turnSignal === 'hazard') graphics.circle(halfLength - 2, -halfWidth + 2, 4).fill(signal);
      if (vehicle.turnSignal === 'right' || vehicle.turnSignal === 'hazard') graphics.circle(halfLength - 2, halfWidth - 2, 4).fill(signal);
    }
    if (vehicle.isCrashed) graphics.rect(-halfLength - 4, -halfWidth - 4, config.length + 8, config.width + 8).stroke({ color: 0xf97316, width: 3 });
  }

  private drawVehicleIndicators(graphics: Graphics, vehicle: VehicleInstance) {
    const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan;
    const halfLength = config.length / 2;
    const halfWidth = config.width / 2;
    graphics.clear();
    graphics.rect(halfLength - 4, -halfWidth + 2, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
    graphics.rect(halfLength - 4, halfWidth - 7, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
    graphics.rect(-halfLength - 1, -halfWidth + 2, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);
    graphics.rect(-halfLength - 1, halfWidth - 7, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);
    if (vehicle.turnSignal !== 'none' && Math.floor(Date.now() / 350) % 2 === 0) {
      if (vehicle.turnSignal === 'left' || vehicle.turnSignal === 'hazard') graphics.circle(halfLength - 2, -halfWidth + 2, 4).fill(0xf59e0b);
      if (vehicle.turnSignal === 'right' || vehicle.turnSignal === 'hazard') graphics.circle(halfLength - 2, halfWidth - 2, 4).fill(0xf59e0b);
    }
    // Emergency lightbar. Ambulance/police used to render as a plain sedan
    // with no siren livery at all — this is what actually identifies them
    // as emergency vehicles at a glance, flashing on the same 150ms cadence
    // as the Canvas renderer.
    const flash = Math.floor(Date.now() / 150) % 2 === 0;
    if (vehicle.type === 'ambulance') {
      graphics.rect(halfLength * 0.1, -8, 8, 16).fill(flash ? 0xef4444 : 0x3b82f6);
    } else if (vehicle.type === 'police') {
      graphics.rect(-2, -7, 6, 7).fill(flash ? 0xef4444 : 0x3b82f6);
      graphics.rect(-2, 0, 6, 7).fill(flash ? 0x3b82f6 : 0xef4444);
    }
    if (vehicle.isCrashed) {
      graphics.rect(-halfLength - 4, -halfWidth - 4, config.length + 8, config.width + 8).stroke({ color: 0xf97316, width: 3 });
      // "!" warning marker above the vehicle, approximated without a Text
      // object (this graphic is cached/regenerated as a texture, so a glyph
      // would need to be baked in some other way): a triangle plus a stem
      // and dot standing in for the exclamation mark.
      graphics.poly([0, -halfWidth - 19, 10, -halfWidth - 4, -10, -halfWidth - 4]).fill(0xfacc15);
      graphics.rect(-1.5, -halfWidth - 17, 3, 8).fill(0x111827);
      graphics.circle(0, -halfWidth - 6, 1.6).fill(0x111827);
    }
  }

  /** Indicators are regenerated only when their state changes, then rendered as a Sprite. */
  /**
   * Sprite templates are rasterised once. Generating them at screen density
   * (instead of Pixi's default resolution of 1) keeps vehicles and props crisp
   * without changing their size in world units.
   */
  private generateSpriteTexture(template: Graphics) {
    return this.app.renderer.generateTexture({
      target: template,
      resolution: this.spriteResolution,
      antialias: true,
    });
  }

  private getVehicleIndicatorTexture(vehicle: VehicleInstance) {
    const blink = Math.floor(Date.now() / 350) % 2;
    const lightbarBlink = Math.floor(Date.now() / 150) % 2;
    const key = `${vehicle.type}:${vehicle.headlights}:${vehicle.isBraking}:${vehicle.turnSignal}:${vehicle.isCrashed ? 1 : 0}:${blink}:${lightbarBlink}`;
    const existing = this.indicatorTextures.get(key);
    if (existing) return existing;
    const template = new Graphics();
    this.drawVehicleIndicators(template, vehicle);
    const texture = this.generateSpriteTexture(template);
    template.destroy();
    this.indicatorTextures.set(key, texture);
    return texture;
  }

  private getEffectTexture(kind: 'skid' | 'particle' | 'splinter' | 'headlight-low' | 'headlight-high' | 'lamp' | 'beacon-ring' | 'beacon-dot') {
    const existing = this.effectTextures.get(kind);
    if (existing) return existing;
    const template = new Graphics();
    switch (kind) {
      case 'skid':
        template.rect(0, 0, 16, 2).fill(0x0f172a);
        break;
      case 'particle':
        template.circle(8, 8, 8).fill(0xffffff);
        break;
      case 'splinter':
        template.rect(0, 0, 12, 2).fill(0xffffff);
        break;
      case 'headlight-low':
        template.poly([0, 70, 190, 18, 190, 122]).fill(0xfef08a);
        break;
      case 'headlight-high':
        template.poly([0, 90, 270, 8, 270, 172]).fill(0xfef08a);
        break;
      case 'lamp':
        template.circle(90, 90, 90).fill(0xfef08a);
        break;
      case 'beacon-ring':
        template.circle(40, 40, 36).stroke({ color: 0xfde047, width: 4, alpha: 0.9 });
        break;
      case 'beacon-dot':
        template.circle(10, 10, 10).fill({ color: 0xfde047, alpha: 0.85 });
        break;
    }
    const texture = this.generateSpriteTexture(template);
    template.destroy();
    this.effectTextures.set(kind, texture);
    return texture;
  }

  private acquireEffectSprite(map: Map<string, Sprite>, id: string, layer: Container, texture: Texture) {
    let sprite = map.get(id);
    if (!sprite) {
      sprite = this.effectPool.pop() || new Sprite(texture);
      sprite.texture = texture;
      sprite.anchor.set(0.5);
      layer.addChild(sprite);
      map.set(id, sprite);
    }
    return sprite;
  }

  private releaseEffects(map: Map<string, Sprite>, active: Set<string>) {
    for (const [id, sprite] of map) {
      if (active.has(id)) continue;
      map.delete(id);
      sprite.visible = false;
      sprite.removeFromParent();
      this.effectPool.push(sprite);
    }
  }

  private getVehicleTexture(vehicle: VehicleInstance) {
    const key = `${vehicle.type}:${vehicle.color}`;
    const existing = this.vehicleTextures.get(key);
    if (existing) return existing;
    const template = new Graphics();
    this.drawVehicle(template, { ...vehicle, headlights: 0, turnSignal: 'none', isBraking: false, isCrashed: false });
    const texture = this.generateSpriteTexture(template);
    template.destroy();
    this.vehicleTextures.set(key, texture);
    return texture;
  }

  private getPedestrianTexture(pedestrian: Pedestrian) {
    const key = `${pedestrian.skinColor}:${pedestrian.shirtColor}:${pedestrian.pantsColor}:${pedestrian.isDriver ? 'driver' : 'walker'}`;
    const existing = this.pedestrianTextures.get(key);
    if (existing) return existing;
    const template = new Graphics();
    const pants = colorNumber(pedestrian.pantsColor);
    const shirt = colorNumber(pedestrian.shirtColor);
    template.ellipse(0, 1, 8, 6).fill({ color: 0x000000, alpha: 0.32 });
    template.rect(-4, -6, 3, 5).fill(pants);
    template.rect(1, 2, 3, 5).fill(pants);
    template.roundRect(-4, -3, 8, 7, 2).fill(shirt).stroke({ color: 0x0f172a, width: 1 });
    template.rect(-5, -1, 2, 4).fill(shirt);
    template.rect(3, -1, 2, 4).fill(shirt);
    template.circle(1, -6, 4).fill(colorNumber(pedestrian.skinColor)).stroke({ color: 0x0f172a, width: 1 });
    if (pedestrian.isDriver) template.rect(-5, -10, 10, 2).fill(0xfacc15);
    const texture = this.generateSpriteTexture(template);
    template.destroy();
    this.pedestrianTextures.set(key, texture);
    return texture;
  }

  private getPropTexture(prop: DestructibleObject) {
    const key = `${prop.type}:${prop.width}:${prop.height}`;
    const existing = this.propTextures.get(key);
    if (existing) return existing;
    const template = new Graphics();
    this.drawProp(template, prop);
    const texture = this.generateSpriteTexture(template);
    template.destroy();
    this.propTextures.set(key, texture);
    return texture;
  }

  private getTrafficLightTexture(light: TrafficLight) {
    const key = `${light.state}:${light.pedestrianState}`;
    const existing = this.trafficLightTextures.get(key);
    if (existing) return existing;
    const template = new Graphics();
    this.drawTrafficLight(template, light);
    const texture = this.generateSpriteTexture(template);
    template.destroy();
    this.trafficLightTextures.set(key, texture);
    return texture;
  }

  private drawHeadlight(graphics: Graphics, x: number, y: number, angle: number, mode: number) {
    const distance = mode === 2 ? 270 : 190;
    const spread = mode === 2 ? 0.38 : 0.28;
    const left = angle - spread;
    const right = angle + spread;
    graphics
      .poly([
        x,
        y,
        x + Math.cos(left) * distance,
        y + Math.sin(left) * distance,
        x + Math.cos(right) * distance,
        y + Math.sin(right) * distance,
      ])
      .fill({ color: 0xfef08a, alpha: 0.08 });
  }

  private getView(map: Map<string, EntityView>, id: string, layer: Container, texture?: Texture) {
    let view = map.get(id);
    if (!view) {
      view = createEntityView(layer, texture);
      map.set(id, view);
    }
    return view;
  }

  private hideInactive(map: Map<string, EntityView>, active: Set<string>) {
    for (const [id, view] of map) {
      if (!active.has(id)) view.container.visible = false;
    }
  }

  private isVisible(x: number, y: number, width: number, height: number, bounds: Bounds) {
    return x + width / 2 >= bounds.left
      && x - width / 2 <= bounds.right
      && y + height / 2 >= bounds.top
      && y - height / 2 <= bounds.bottom;
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.staticTexture?.destroy(true);
    if (this.initialized) this.disposeApplication();
    this.vehicleViews.clear();
    this.pedestrianViews.clear();
    this.propViews.clear();
    this.trafficLightViews.clear();
    for (const texture of this.vehicleTextures.values()) texture.destroy(true);
    this.vehicleTextures.clear();
    for (const texture of this.propTextures.values()) texture.destroy(true);
    this.propTextures.clear();
    for (const texture of this.trafficLightTextures.values()) texture.destroy(true);
    this.trafficLightTextures.clear();
    for (const texture of this.indicatorTextures.values()) texture.destroy(true);
    this.indicatorTextures.clear();
    for (const texture of this.effectTextures.values()) texture.destroy(true);
    this.effectTextures.clear();
    this.skidSprites.clear();
    for (const label of this.nameLabels.values()) label.destroy();
    this.nameLabels.clear();
    this.particleSprites.clear();
    this.lightSprites.clear();
    this.effectPool.length = 0;
    for (const texture of this.pedestrianTextures.values()) texture.destroy(true);
    this.pedestrianTextures.clear();
  }

  private disposeApplication() {
    if (this.appDestroyed) return;
    this.appDestroyed = true;
    this.app.destroy({ removeView: false }, { children: true, texture: false, textureSource: false });
  }
}

type Bounds = { left: number; top: number; right: number; bottom: number };

const canvasWidth = (canvas: HTMLCanvasElement) => canvas.clientWidth || canvas.width || window.innerWidth;
const canvasHeight = (canvas: HTMLCanvasElement) => canvas.clientHeight || canvas.height || window.innerHeight;

const lineVisible = (x1: number, y1: number, x2: number, y2: number, bounds: Bounds) =>
  Math.max(x1, x2) >= bounds.left
  && Math.min(x1, x2) <= bounds.right
  && Math.max(y1, y2) >= bounds.top
  && Math.min(y1, y2) <= bounds.bottom;
