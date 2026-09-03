import React, { useEffect, useRef, useState, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  ChatMessage,
  DestructibleObject,
  Mission,
  Pedestrian,
  PlayerCharacter,
  PointOfInterest,
  RemotePlayer,
  VehicleCategory,
  VehicleInstance,
} from './types';
import { CityMap } from './game/cityMap';
import { PhysicsEngine } from './game/physics';
import { TrafficAI } from './game/trafficAI';
import { MissionManager } from './game/missions';
import type { PixiGameRenderer } from './game/pixiRenderer';
import { MultiplayerClient } from './network/multiplayerClient';
import { sound } from './audio/soundEngine';
import { HUD } from './components/HUD';
import { GarageModal } from './components/GarageModal';
import { MissionsModal } from './components/MissionsModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { FullMapModal } from './components/FullMapModal';
import { NetworkFeed, FeedEvent } from './components/NetworkFeed';
import { VirtualControls } from './components/VirtualControls';
import { VEHICLE_CONFIGS } from './game/vehicleConfigs';
import { FixedStepAccumulator } from './game/fixedStep';
import { randomDriverName } from './game/nameGenerator';
import { loadUserPreferences, saveUserPreferences, UserPreferences } from './game/userPreferences';

// Distance (world units) at which a remote player's horn/siren fades to
// silence, and the volume it plays at right next to the local player. A
// siren carries further than a horn, matching how it reads in real traffic.
const REMOTE_HORN_MAX_DIST = 900;
const REMOTE_HORN_BASE_VOLUME = 0.28;
const REMOTE_SIREN_MAX_DIST = 1400;
const REMOTE_SIREN_BASE_VOLUME = 0.18;

// How long a chat/join/leave toast stays on screen before it auto-dismisses.
const FEED_EVENT_TTL_MS = 6000;

/**
 * A ref argument is evaluated on every render even though React keeps only the
 * first value. Building the city that way cost ~195ms per render and, with the
 * HUD ticking five times a second, saturated the main thread. The factory here
 * runs exactly once.
 */
function useLazyRef<T>(create: () => T) {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = create();
  return ref as React.MutableRefObject<T>;
}

/**
 * `md:hidden` on the virtual joystick gated on viewport width, not on
 * whether the device has touch input. Most tablets are wider than the 768px
 * breakpoint in landscape (and plenty in portrait too), so they lost the
 * on-screen controls entirely while the keyboard-shortcut legend kept
 * showing regardless - a touch-only device with no way to drive.
 */
function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
  );

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouch(query.matches || navigator.maxTouchPoints > 0);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isTouch;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const preferencesRef = useLazyRef<UserPreferences>(loadUserPreferences);

  // Core Engine instances in refs to prevent React state re-render bottlenecks during 60 FPS loop
  const cityMapRef = useLazyRef<CityMap>(() => new CityMap());
  const physicsRef = useLazyRef<PhysicsEngine>(() => new PhysicsEngine());
  const trafficRef = useLazyRef<TrafficAI>(() => new TrafficAI(cityMapRef.current));
  const missionsRef = useLazyRef<MissionManager>(() => new MissionManager());
  const rendererRef = useRef<PixiGameRenderer | null>(null);
  const multiplayerRef = useRef<MultiplayerClient | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  // Player State
  const playerVehicleRef = useRef<VehicleInstance>({
    id: 'player_kamaz_primary',
    type: preferencesRef.current.vehicleType && VEHICLE_CONFIGS[preferencesRef.current.vehicleType as VehicleCategory]
      ? preferencesRef.current.vehicleType as VehicleCategory
      : 'kamaz_dump',
    x: 1000,
    y: 1000,
    angle: 0,
    speed: 0,
    steeringAngle: 0,
    angularVelocity: 0,
    color: preferencesRef.current.vehicleColor || '#f97316',
    health: 100,
    maxHealth: 100,
    headlights: 1, // low beam by default
    turnSignal: 'none',
    isBraking: false,
    isReversing: false,
    isHonking: false,
    isSiren: false,
    isPlayer: true,
    smokeTimer: 0,
  });

  const playerCharRef = useRef<PlayerCharacter>({
    x: 1000,
    y: 1000,
    angle: 0,
    speed: 0,
    health: 100,
    maxHealth: 100,
    inVehicleId: 'player_kamaz_primary',
    isRunning: false,
    name: preferencesRef.current.playerName || 'Дальнобойщик',
    money: 25000,
    xp: 150,
    level: 1,
    inventory: { repairKits: 3, fuelCans: 2 },
  });

  const [inVehicle, setInVehicle] = useState<boolean>(true);
  const isTouchDevice = useIsTouchDevice();
  const inVehicleStateRef = useRef<boolean>(true);

  // Input states
  const keysRef = useRef<{ [key: string]: boolean }>({});

  // UI Reactive States (for HUD & Modals)
  const [streetName, setStreetName] = useState<string>('Главная Автобаза КАМАЗ');
  const [fps, setFps] = useState<number>(60);
  const [, setHudTick] = useState(0);
  const [carCount, setCarCount] = useState<number>(45);
  const [pedCount, setPedCount] = useState<number>(40);
  const [isNight, setIsNight] = useState<boolean>(preferencesRef.current.isNight);
  const [isMuted, setIsMuted] = useState<boolean>(preferencesRef.current.muted);
  const [zoom, setZoom] = useState<number>(preferencesRef.current.zoom);
  // The render loop reads these through refs. Putting them in the effect's
  // dependency list would tear down the WebGL renderer - and re-upload the
  // whole city texture - every time the player zooms or picks a mission.
  const zoomRef = useRef(preferencesRef.current.zoom);
  const targetPoiRef = useRef<PointOfInterest | null>(null);

  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [targetPoi, setTargetPoi] = useState<PointOfInterest | null>(null);

  // Modals
  const [showGarage, setShowGarage] = useState<boolean>(false);
  const [showMissions, setShowMissions] = useState<boolean>(false);
  const [showMultiplayer, setShowMultiplayer] = useState<boolean>(false);
  const [showFullMap, setShowFullMap] = useState<boolean>(false);
  const modalOpenRef = useRef(false);
  const showFullMapRef = useRef(false);
  const showGarageRef = useRef(false);
  const showMissionsRef = useRef(false);

  // Multiplayer UI State
  const [mpStatus, setMpStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mpRoomId, setMpRoomId] = useState<string>(preferencesRef.current.roomId || 'default');
  const [playerName, setPlayerName] = useState<string>(() => preferencesRef.current.playerName || randomDriverName());
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);

  // Pushes a toast onto the on-screen radio feed and schedules its own
  // removal — callers don't need to track timers themselves.
  const pushFeedEvent = useCallback((entry: Omit<FeedEvent, 'id'>) => {
    const id = `feed_${Date.now()}_${Math.random()}`;
    setFeedEvents((prev) => [...prev.slice(-5), { ...entry, id }]);
    setTimeout(() => {
      setFeedEvents((prev) => prev.filter((ev) => ev.id !== id));
    }, FEED_EVENT_TTL_MS);
  }, []);

  // Cosmetic settings stay on this device only. Multiplayer identity remains
  // server-assigned; the saved nickname is merely a preferred display name.
  useEffect(() => {
    sound.setMuted(isMuted);
    saveUserPreferences({
      muted: isMuted,
      zoom,
      isNight,
      playerName,
      roomId: mpRoomId,
      vehicleType: playerVehicleRef.current.type,
      vehicleColor: playerVehicleRef.current.color,
    });
  }, [isMuted, zoom, isNight, playerName, mpRoomId]);

  // Initialize Multiplayer Client
  useEffect(() => {
    const mp = new MultiplayerClient(playerName, {
      onInit: (yourId, players, destructibles, spawn, assignedName) => {
        setMyPlayerId(yourId);
        setRemotePlayers(players);
        if (assignedName) {
          setPlayerName(assignedName);
          playerCharRef.current.name = assignedName;
          mp.playerName = assignedName;
        }
        // The authoritative server assigns a free multiplayer spawn. Apply it
        // before the game loop sends its first position update, otherwise all
        // fresh clients overwrite their reserved pads with the local default.
        if (spawn) {
          playerVehicleRef.current.x = spawn.x;
          playerVehicleRef.current.y = spawn.y;
          playerVehicleRef.current.angle = spawn.angle;
          playerCharRef.current.x = spawn.x;
          playerCharRef.current.y = spawn.y;
          playerCharRef.current.angle = spawn.angle;
        }
        // Sync destructible objects
        if (destructibles) {
          cityMapRef.current.destructibles.forEach((obj) => {
            if (destructibles[obj.id]?.destroyed) {
              obj.isDestroyed = true;
            }
          });
        }
      },
      // Only membership changes reach React. Position updates used to call
      // setState ~22 times per second per remote player, re-rendering the whole
      // app; the render loop reads positions straight off the client instead.
      onPlayerJoined: (player) => {
        setRemotePlayers((prev) => [...prev.filter((p) => p.id !== player.id), player]);
        pushFeedEvent({ type: 'join', playerId: player.id, name: player.name });
      },
      onPlayerLeft: (playerId) => {
        setRemotePlayers((prev) => {
          const left = prev.find((p) => p.id === playerId);
          if (left) pushFeedEvent({ type: 'leave', playerId: left.id, name: left.name });
          return prev.filter((p) => p.id !== playerId);
        });
        sound.clearRemotePlayerSounds(playerId);
      },
      onObjectDestroyed: (objectId) => {
        const obj = cityMapRef.current.destructibles.find((d) => d.id === objectId);
        if (obj && !obj.isDestroyed) {
          obj.isDestroyed = true;
          physicsRef.current.spawnExplosionParticles(obj.x, obj.y, obj.type);
        }
      },
      onObjectRespawned: (objectId) => {
        const obj = cityMapRef.current.destructibles.find((d) => d.id === objectId);
        if (obj) {
          obj.isDestroyed = false;
        }
      },
      onChatMessage: (msg) => {
        setChatMessages((prev) => [...prev.slice(-40), msg]);
        pushFeedEvent({ type: 'chat', playerId: msg.playerId, name: msg.name, text: msg.text });
      },
      onStatusChange: (status) => {
        setMpStatus(status);
        if (status !== 'connected') sound.clearAllRemoteSounds();
      },
      onNameAssigned: (name) => {
        setPlayerName(name);
        playerCharRef.current.name = name;
      },
    });

    multiplayerRef.current = mp;
    mp.connect(mpRoomId);

    return () => {
      mp.disconnect();
    };
  }, []);

  // Update InVehicle ref
  useEffect(() => {
    inVehicleStateRef.current = inVehicle;
  }, [inVehicle]);

  // Global game shortcuts stay registered while a dialog is on screen, so
  // mirror that state in a ref for the stable keyboard listener below.
  useEffect(() => {
    modalOpenRef.current = showGarage || showMissions || showMultiplayer || showFullMap;
    showFullMapRef.current = showFullMap;
    showGarageRef.current = showGarage;
    showMissionsRef.current = showMissions;
  }, [showGarage, showMissions, showMultiplayer, showFullMap]);

  // Handle Keyboard Input
  useEffect(() => {
    const clearActiveInputs = () => {
      keysRef.current = {};
      playerVehicleRef.current.isHonking = false;
      sound.stopHorn();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Un-mute Audio on first interaction
      sound.init();

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't capture inputs when typing in chat
      }

      if (modalOpenRef.current) {
        if (!e.repeat && e.code === 'Escape') {
          setShowGarage(false);
          setShowMissions(false);
          setShowMultiplayer(false);
          setShowFullMap(false);
        } else if (
          !e.repeat &&
          (e.code === 'KeyM' || e.code === 'KeyG' || (e.code === 'KeyJ' && !e.ctrlKey))
        ) {
          // Each modal's shortcut also closes it, mirroring Escape — but if a
          // *different* modal is open, the key switches straight to its own
          // modal instead of requiring a close-then-reopen. Multiplayer has no
          // shortcut of its own, so it always yields to one here.
          const wasOpen =
            e.code === 'KeyM' ? showFullMapRef.current
            : e.code === 'KeyG' ? showGarageRef.current
            : showMissionsRef.current;
          setShowFullMap(!wasOpen && e.code === 'KeyM');
          setShowGarage(!wasOpen && e.code === 'KeyG');
          setShowMissions(!wasOpen && e.code === 'KeyJ');
          setShowMultiplayer(false);
        }
        return;
      }

      keysRef.current[e.code] = true;

      // Browsers repeat keydown while a key is held. Movement should keep its
      // pressed state, but actions such as getting out, opening a modal or
      // switching lights must run once per physical press. Otherwise holding
      // E can immediately put the player back in the vehicle.
      if (e.repeat) return;

      // Handle Key Toggles
      if (e.code === 'KeyE') {
        toggleEnterExitVehicle();
      } else if (e.code === 'KeyL') {
        cycleHeadlights();
      } else if (e.code === 'KeyQ') {
        toggleTurnSignal('left');
      } else if (e.code === 'KeyZ') {
        toggleTurnSignal('right');
      } else if (e.code === 'KeyX') {
        toggleTurnSignal('hazard');
      } else if (e.code === 'KeyR') {
        repairVehicle();
      } else if (e.code === 'KeyT') {
        toggleDayNight();
      } else if (e.code === 'KeyM') {
        setShowFullMap((prev) => !prev);
      } else if (e.code === 'KeyG') {
        setShowGarage((prev) => !prev);
      } else if (e.code === 'KeyJ' && !e.ctrlKey) {
        // If in police/ambulance toggle siren, otherwise open missions
        const v = playerVehicleRef.current;
        if (inVehicleStateRef.current && (v.type === 'ambulance' || v.type === 'police')) {
          v.isSiren = !v.isSiren;
          sound.setSiren(v.isSiren);
        } else {
          setShowMissions((prev) => !prev);
        }
      } else if (e.code === 'KeyH') {
        playerVehicleRef.current.isHonking = true;
        sound.startHorn(playerVehicleRef.current.type.startsWith('kamaz'));
      } else if (e.code === 'Minus') {
        setZoom((prev) => Math.max(0.6, prev - 0.1));
      } else if (e.code === 'Equal') {
        setZoom((prev) => Math.min(1.5, prev + 0.1));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      keysRef.current[e.code] = false;

      if (e.code === 'KeyH') {
        playerVehicleRef.current.isHonking = false;
        sound.stopHorn();
      }
    };

    const handleWindowBlur = () => clearActiveInputs();
    const handleVisibilityChange = () => {
      if (document.hidden) clearActiveInputs();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Enter / Exit Vehicle Logic
  const toggleEnterExitVehicle = useCallback(() => {
    sound.playDoor();
    const v = playerVehicleRef.current;
    const char = playerCharRef.current;

    if (inVehicleStateRef.current) {
      // Exit vehicle
      char.x = v.x - Math.sin(v.angle) * 35;
      char.y = v.y + Math.cos(v.angle) * 35;
      char.angle = v.angle;
      char.inVehicleId = null;
      v.speed = 0;
      setInVehicle(false);
    } else {
      // Check nearest vehicle (Player's car or any NPC car!)
      const distToPlayerCar = Math.hypot(v.x - char.x, v.y - char.y);
      if (distToPlayerCar < 90) {
        char.inVehicleId = v.id;
        setInVehicle(true);
        return;
      }

      // Check NPC cars
      for (const npc of trafficRef.current.npcVehicles) {
        const d = Math.hypot(npc.x - char.x, npc.y - char.y);
        if (d < 70) {
          // Commandeer NPC vehicle!
          trafficRef.current.npcVehicles = trafficRef.current.npcVehicles.filter((vehicle) => vehicle.id !== npc.id);
          playerVehicleRef.current = { ...npc, isPlayer: true };
          char.inVehicleId = npc.id;
          setInVehicle(true);
          break;
        }
      }
    }
  }, []);

  // Turn signal toggler
  const toggleTurnSignal = useCallback((sig: 'left' | 'right' | 'hazard') => {
    sound.playBlinkerClick();
    const v = playerVehicleRef.current;
    if (v.turnSignal === sig) {
      v.turnSignal = 'none';
    } else {
      v.turnSignal = sig;
    }
  }, []);

  // Headlights cycler
  const cycleHeadlights = useCallback(() => {
    sound.playBlinkerClick();
    const v = playerVehicleRef.current;
    v.headlights = (v.headlights + 1) % 3; // 0 -> 1 (low) -> 2 (high) -> 0
  }, []);

  // Repair vehicle
  const repairVehicle = useCallback(() => {
    sound.playReward();
    playerVehicleRef.current.health = 100;
    playerCharRef.current.health = 100;
  }, []);

  // Day/Night toggle
  const toggleDayNight = useCallback(() => {
    setIsNight((prev) => {
      const next = !prev;
      if (rendererRef.current) {
        rendererRef.current.isNightMode = next;
      }
      return next;
    });
  }, []);

  // Main 60 FPS Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let pixiRenderer: PixiGameRenderer | null = null;

    // Pixi's WebGL clear color is opaque black; revealing the canvas before
    // it has actually painted a frame reads as a black flash on every load.
    // Stays hidden until the render loop below sees pixiStatus flip to
    // 'rendered', then it's shown once and left alone.
    canvas.style.visibility = 'hidden';

    const probeCanvas = document.createElement('canvas');
    const webglAvailable = Boolean(
      probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl')
    );
    if (!webglAvailable) {
      setWebglUnavailable(true);
    } else {
      void import('./game/pixiRenderer').then(({ PixiGameRenderer }) => {
        if (disposed) return;
        pixiRenderer = new PixiGameRenderer(canvas);
        rendererRef.current = pixiRenderer;
        void pixiRenderer.ready.catch(() => setWebglUnavailable(true));
      }).catch(() => setWebglUnavailable(true));
    }

    let animationFrameId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let lastHudUpdate = performance.now();
    let lastPerformanceReport = performance.now();
    const simulation = new FixedStepAccumulator();
    let lastStreetName = streetName;
    const handleVehicleCrash = (
      firstVehicle: VehicleInstance,
      secondVehicle: VehicleInstance | undefined,
      impactSpeed: number,
      x: number,
      y: number
    ) => {
      trafficRef.current.handleVehicleCrash(firstVehicle, secondVehicle, impactSpeed, x, y);
      physicsRef.current.emitSparks(x, y, 20);
      physicsRef.current.emitDamageSmoke({ ...firstVehicle, x, y }, true);
      if (secondVehicle && !secondVehicle.isPlayer) {
        physicsRef.current.emitDamageSmoke({ ...secondVehicle, x, y }, true);
      }
    };

    const loop = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // FPS calculation
      frameCount++;
      if (now - lastFpsUpdate > 500) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)));
        frameCount = 0;
        lastFpsUpdate = now;
      }
      // The simulation lives in refs for 60 FPS performance, so refresh only
      // the HUD-facing React tree at a steady 10 FPS. This keeps the speed
      // readout responsive without rerendering the whole app every frame.
      if (now - lastHudUpdate > 200) {
        setHudTick((tick) => tick + 1);
        setCarCount(trafficRef.current.npcVehicles.length);
        setPedCount(trafficRef.current.pedestrians.length);
        lastHudUpdate = now;
      }

      // Player input remains responsive at display rate. Expensive NPC
      // simulation below runs at a bounded fixed 30Hz instead.
      const keys = keysRef.current;
      const v = playerVehicleRef.current;
      const char = playerCharRef.current;
      const isCar = inVehicleStateRef.current;

      if (isCar) {
        physicsRef.current.updatePlayerVehicle(
          v,
          {
            throttle: Boolean(keys['KeyW'] || keys['ArrowUp']),
            brake: Boolean(keys['KeyS'] || keys['ArrowDown']),
            reverse: Boolean(keys['KeyS'] || keys['ArrowDown']),
            steerLeft: Boolean(keys['KeyA'] || keys['ArrowLeft']),
            steerRight: Boolean(keys['KeyD'] || keys['ArrowRight']),
            handbrake: Boolean(keys['Space']),
          },
          delta
        );

        // Synchronize engine sound pitch
        const isThrottle = Boolean(keys['KeyW'] || keys['ArrowUp']);
        const isKamaz = v.type.startsWith('kamaz');
        sound.updateEngine(Math.round(v.speed * 3.6), isThrottle, isKamaz);
      } else {
        physicsRef.current.updatePlayerCharacter(
          char,
          {
            up: Boolean(keys['KeyW'] || keys['ArrowUp']),
            down: Boolean(keys['KeyS'] || keys['ArrowDown']),
            left: Boolean(keys['KeyA'] || keys['ArrowLeft']),
            right: Boolean(keys['KeyD'] || keys['ArrowRight']),
            sprint: Boolean(keys['ShiftLeft'] || keys['ShiftRight']),
          },
          delta,
          cityMapRef.current.buildings
        );
        sound.stopEngine();
      }

      const playerPos = isCar ? { x: v.x, y: v.y } : { x: char.x, y: char.y };
      const simulationStarted = performance.now();
      const simulationSteps = simulation.consume(delta, (simulationStep) => {
        // 30Hz is sufficient for NPC steering and collision response while
        // avoiding a CPU spike whenever the display refresh is higher.
        cityMapRef.current.updateTrafficLights(simulationStep);
        trafficRef.current.updateTraffic(simulationStep, isCar ? v : undefined);
        trafficRef.current.updatePedestrians(simulationStep, playerPos.x, playerPos.y, v.isHonking, isCar ? v : undefined);

      // 4. Resolve Collisions (Vehicles vs Props vs Pedestrians vs Buildings)
        // The player's own vehicle stays a solid obstacle (and a valid crash
        // target) even after they step out of it and it's parked, not
        // dropped from the simulation entirely.
        physicsRef.current.resolveAllCollisions(
        [v, ...trafficRef.current.npcVehicles],
        cityMapRef.current.destructibles,
        trafficRef.current.pedestrians,
        cityMapRef.current.buildings,
        (propId) => {
          multiplayerRef.current?.sendObjectDestroyed(propId);
        },
        simulationStep,
        (event, firstVehicle, secondVehicle) => {
          handleVehicleCrash(
            firstVehicle,
            secondVehicle,
            event.impactSpeed,
            event.x,
            event.y
          );
        }
        );

        // Damage effects belong to the vehicle, not to the driver. Running
        // this in the fixed simulation keeps smoke and fire active while the
        // player is on foot as well as while NPC wrecks wait roadside.
        for (const vehicle of [v, ...trafficRef.current.npcVehicles]) {
          physicsRef.current.updateVehicleDamageEffects(vehicle, simulationStep);
        }

      // 5. Update Particles
        physicsRef.current.updateParticles(simulationStep);

      // 6. Update Missions & Check Arrival
        const missionResult = missionsRef.current.update(simulationStep);
        if (missionResult.failed) {
          setActiveMission(null);
          setTargetPoi(null);
        }

        const arrivalResult = missionsRef.current.checkZoneArrival(
        playerPos.x,
        playerPos.y,
        cityMapRef.current.pois
        );

        if (arrivalResult.reachedPickup && arrivalResult.pickupPoi) {
        sound.playReward();
        const active = missionsRef.current.activeMission;
        if (active) {
          const destPoi = cityMapRef.current.pois.find((p) => p.id === active.targetPoiId);
          setTargetPoi(destPoi || null);
        }
        }

        if (arrivalResult.completedMission) {
        sound.playReward();
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        char.money += arrivalResult.completedMission.rewardMoney;
        char.xp += arrivalResult.completedMission.rewardXp;
        // Level up check
        if (char.xp >= char.level * 500) {
          char.level += 1;
          char.money += 10000;
        }
        setActiveMission(null);
        setTargetPoi(null);
        }

      // Auto-repair at Workshop
        const workshopPoi = cityMapRef.current.pois.find((p) => p.type === 'workshop');
        if (workshopPoi && isCar && v.health < 100) {
        const dWorkshop = Math.hypot(workshopPoi.x - v.x, workshopPoi.y - v.y);
        if (dWorkshop < Math.max(workshopPoi.width, workshopPoi.height) * 0.5) {
          v.health = Math.min(100, v.health + simulationStep * 25);
          if (Math.random() < 0.2) {
            physicsRef.current.spawnSparks(v.x, v.y);
          }
        }
        }
      });
      const simulationMs = performance.now() - simulationStarted;

      // 7. Update HUD Info (Street Name)
      const currentStreet = cityMapRef.current.getStreetNameAt(playerPos.x, playerPos.y);
      if (currentStreet !== lastStreetName) {
        lastStreetName = currentStreet;
        setStreetName(currentStreet);
      }

      // 8. Multiplayer Telemetry Broadcast
      if (multiplayerRef.current && multiplayerRef.current.status === 'connected') {
        multiplayerRef.current.sendUpdate({
          x: isCar ? v.x : char.x,
          y: isCar ? v.y : char.y,
          angle: isCar ? v.angle : char.angle,
          speed: isCar ? v.speed : char.speed,
          steering: v.steeringAngle,
          inVehicle: isCar,
          vehicleType: v.type,
          vehicleColor: v.color,
          condition: v.health,
          headlights: v.headlights,
          turnSignal: v.turnSignal,
          isHonking: v.isHonking,
          isSiren: v.isSiren,
        });
      }

      // Reveal the canvas only once Pixi has actually painted a frame,
      // instead of showing its black WebGL clear color while it loads.
      // visibility:hidden (unlike display:none) still reports real layout
      // dimensions, so sizing below is accurate even before this reveal.
      if (canvas.style.visibility === 'hidden' && canvas.dataset.pixiStatus === 'rendered') {
        canvas.style.visibility = '';
      }

      // 9. Render Scene
      // Interpolated: the network stream is 20Hz, the display is not.
      const interpolatedRemotePlayers = multiplayerRef.current?.getInterpolatedPlayers() || [];

      // Spatialized horn/siren for remote players: volume falls off with
      // distance from the local player so a honk on the other side of the map
      // isn't as loud as one right next to you.
      const listenerX = isCar ? v.x : char.x;
      const listenerY = isCar ? v.y : char.y;
      interpolatedRemotePlayers.forEach((p) => {
        const dist = Math.hypot(p.x - listenerX, p.y - listenerY);
        const isKamaz = p.vehicleType?.startsWith('kamaz') ?? false;

        const hornFalloff = Math.max(0, 1 - dist / REMOTE_HORN_MAX_DIST);
        const hornVolume = REMOTE_HORN_BASE_VOLUME * hornFalloff * hornFalloff;
        sound.updateRemoteHorn(p.id, p.isHonking && p.inVehicle, isKamaz, hornVolume);

        const sirenFalloff = Math.max(0, 1 - dist / REMOTE_SIREN_MAX_DIST);
        const sirenVolume = REMOTE_SIREN_BASE_VOLUME * sirenFalloff * sirenFalloff;
        sound.updateRemoteSiren(p.id, p.isSiren && p.inVehicle, sirenVolume);
      });

      if (rendererRef.current) {
        rendererRef.current.zoom = zoomRef.current;
        rendererRef.current.frameDelta = delta;
        rendererRef.current.render(
          canvas.clientWidth || window.innerWidth,
          canvas.clientHeight || window.innerHeight,
          cityMapRef.current,
          v,
          char,
          isCar,
          trafficRef.current.npcVehicles,
          interpolatedRemotePlayers,
          trafficRef.current.pedestrians,
          cityMapRef.current.destructibles,
          physicsRef.current.particles,
          physicsRef.current.skidMarks,
          targetPoiRef.current
        );
      }

      if (import.meta.env.DEV && now - lastPerformanceReport > 2000) {
        const renderer = rendererRef.current;
        if (renderer && 'getPerformanceStats' in renderer) {
          console.debug('[KAMAZ performance]', {
            simulationMs: Number(simulationMs.toFixed(2)),
            simulationSteps,
            ...renderer.getPerformanceStats(),
          });
        }
        lastPerformanceReport = now;
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.isNightMode = isNight;
  }, [isNight]);

  useEffect(() => {
    targetPoiRef.current = targetPoi;
  }, [targetPoi]);

  // Handle Window Resize for Canvas
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        // The canvas's own CSS layout size (w-full h-full) already tracks
        // the window; Pixi reads that and sizes its WebGL surface itself
        // (with the correct device pixel ratio), so it doesn't need this
        // effect to also poke canvas.width/height directly.
        rendererRef.current?.resize(window.innerWidth, window.innerHeight);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle Select Vehicle from Garage
  const handleSelectGarageVehicle = (type: VehicleCategory, color: string) => {
    sound.playDoor();
    const current = playerVehicleRef.current;
    playerVehicleRef.current = {
      ...current,
      type,
      color,
      health: 100,
      turnSignal: 'none',
      isSiren: false,
    };
    saveUserPreferences({
      muted: isMuted,
      zoom,
      isNight,
      playerName,
      roomId: mpRoomId,
      vehicleType: type,
      vehicleColor: color,
    });
    setInVehicle(true);
  };

  // Handle Start Mission
  const handleStartMission = (missionId: string) => {
    missionsRef.current.startMission(missionId);
    const m = missionsRef.current.activeMission;
    setActiveMission(m);
    if (m) {
      const poiId = missionsRef.current.missionStage === 'pickup' ? m.sourcePoiId : m.targetPoiId;
      const poi = cityMapRef.current.pois.find((p) => p.id === poiId);
      setTargetPoi(poi || null);

      // Auto switch to required vehicle type if needed
      if (m.requiredVehicleType && playerVehicleRef.current.type !== m.requiredVehicleType) {
        playerVehicleRef.current.type = m.requiredVehicleType;
        playerVehicleRef.current.color = VEHICLE_CONFIGS[m.requiredVehicleType].defaultColor;
      }
    }
  };

  // Handle Cancel Mission
  const handleCancelMission = () => {
    if (missionsRef.current.activeMission) {
      missionsRef.current.activeMission.status = 'available';
      missionsRef.current.activeMission = null;
      setActiveMission(null);
      setTargetPoi(null);
    }
  };

  // Handle Touch/Virtual inputs
  const handleVirtualInput = (
    action: 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake' | 'horn',
    active: boolean
  ) => {
    sound.init();
    const map: Record<string, string> = {
      throttle: 'KeyW',
      brake: 'KeyS',
      steerLeft: 'KeyA',
      steerRight: 'KeyD',
      handbrake: 'Space',
      horn: 'KeyH',
    };
    const code = map[action];
    if (code) {
      keysRef.current[code] = active;
      if (action === 'horn') {
        playerVehicleRef.current.isHonking = active;
        if (active) sound.startHorn(playerVehicleRef.current.type.startsWith('kamaz'));
        else sound.stopHorn();
      }
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* GPU (Pixi/WebGL) Canvas — the sole renderer now that the Canvas 2D
          fallback engine has been retired. */}
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full cursor-crosshair" />

      {webglUnavailable && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-center p-6 z-[100]">
          <div className="max-w-sm space-y-2">
            <p className="text-slate-100 font-bold text-lg">WebGL недоступен</p>
            <p className="text-slate-400 text-sm">
              Игре нужен WebGL для отрисовки. Обновите браузер, включите аппаратное ускорение
              или попробуйте другое устройство.
            </p>
          </div>
        </div>
      )}

      {/* Primary Game HUD (Exact match to screenshots) */}
      <HUD
        streetName={streetName}
        fps={fps}
        carCount={carCount}
        pedCount={pedCount}
        isNight={isNight}
        onToggleDayNight={toggleDayNight}
        isMuted={isMuted}
        onToggleMute={() => {
          setIsMuted((current) => !current);
        }}
        zoom={zoom}
        onZoomIn={() => setZoom((prev) => Math.min(1.5, prev + 0.1))}
        onZoomOut={() => setZoom((prev) => Math.max(0.6, prev - 0.1))}
        playerVehicle={inVehicle ? playerVehicleRef.current : null}
        playerChar={playerCharRef.current}
        inVehicle={inVehicle}
        cityMap={cityMapRef.current}
        trafficCars={trafficRef.current.npcVehicles}
        remotePlayers={remotePlayers}
        activeMission={activeMission}
        targetPoi={targetPoi}
        onOpenMap={() => setShowFullMap(true)}
        onOpenGarage={() => setShowGarage(true)}
        onOpenMissions={() => setShowMissions(true)}
        onOpenMultiplayer={() => setShowMultiplayer(true)}
        onRepairVehicle={repairVehicle}
        onToggleHeadlights={cycleHeadlights}
        onToggleTurnSignal={toggleTurnSignal}
        onToggleEnterExitVehicle={toggleEnterExitVehicle}
        multiplayerStatus={mpStatus}
        onlineCount={remotePlayers.length}
        isTouchDevice={isTouchDevice}
      />

      {/* Radio feed: chat lines and join/leave, visible without opening the multiplayer modal */}
      <NetworkFeed events={feedEvents} />

      {/* Virtual Controls for mobile touch */}
      {isTouchDevice && <VirtualControls onInput={handleVirtualInput} />}

      {/* Modals */}
      {showGarage && (
        <GarageModal
          currentVehicleType={playerVehicleRef.current.type}
          currentColor={playerVehicleRef.current.color}
          onSelectVehicle={handleSelectGarageVehicle}
          onClose={() => setShowGarage(false)}
        />
      )}

      {showMissions && (
        <MissionsModal
          missions={missionsRef.current.missions}
          activeMission={activeMission}
          playerMoney={playerCharRef.current.money}
          playerLevel={playerCharRef.current.level}
          onStartMission={handleStartMission}
          onCancelMission={handleCancelMission}
          onClose={() => setShowMissions(false)}
        />
      )}

      {showMultiplayer && (
        <MultiplayerModal
          status={mpStatus}
          playerName={playerName}
          myPlayerId={myPlayerId}
          onUpdatePlayerName={(name) => {
            multiplayerRef.current?.rename(name);
          }}
          currentRoomId={mpRoomId}
          onJoinRoom={(roomId) => {
            setMpRoomId(roomId);
            multiplayerRef.current?.connect(roomId);
          }}
          remotePlayers={remotePlayers}
          chatMessages={chatMessages}
          onSendChat={(text) => {
            multiplayerRef.current?.sendChat(text);
          }}
          onClose={() => setShowMultiplayer(false)}
        />
      )}

      {showFullMap && (
        <FullMapModal
          playerX={inVehicle ? playerVehicleRef.current.x : playerCharRef.current.x}
          playerY={inVehicle ? playerVehicleRef.current.y : playerCharRef.current.y}
          playerAngle={inVehicle ? playerVehicleRef.current.angle : playerCharRef.current.angle}
          playerSpeed={inVehicle ? playerVehicleRef.current.speed : playerCharRef.current.speed}
          cityMap={cityMapRef.current}
          trafficCars={trafficRef.current.npcVehicles}
          remotePlayers={remotePlayers}
          targetPoi={targetPoi}
          onClose={() => setShowFullMap(false)}
        />
      )}
    </div>
  );
}
