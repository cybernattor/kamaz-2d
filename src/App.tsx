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
import { GameRenderer } from './game/renderer';
import { MultiplayerClient } from './network/multiplayerClient';
import { sound } from './audio/soundEngine';
import { HUD } from './components/HUD';
import { GarageModal } from './components/GarageModal';
import { MissionsModal } from './components/MissionsModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { FullMapModal } from './components/FullMapModal';
import { VirtualControls } from './components/VirtualControls';
import { VEHICLE_CONFIGS } from './game/vehicleConfigs';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Core Engine instances in refs to prevent React state re-render bottlenecks during 60 FPS loop
  const cityMapRef = useRef<CityMap>(new CityMap());
  const physicsRef = useRef<PhysicsEngine>(new PhysicsEngine());
  const trafficRef = useRef<TrafficAI>(new TrafficAI(cityMapRef.current));
  const missionsRef = useRef<MissionManager>(new MissionManager());
  const rendererRef = useRef<GameRenderer | null>(null);
  const multiplayerRef = useRef<MultiplayerClient | null>(null);

  // Player State
  const playerVehicleRef = useRef<VehicleInstance>({
    id: 'player_kamaz_primary',
    type: 'kamaz_dump',
    x: 1000,
    y: 1000,
    angle: 0,
    speed: 0,
    steeringAngle: 0,
    angularVelocity: 0,
    color: '#f97316',
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
    name: 'Дальнобойщик',
    money: 25000,
    xp: 150,
    level: 1,
    inventory: { repairKits: 3, fuelCans: 2 },
  });

  const [inVehicle, setInVehicle] = useState<boolean>(true);
  const inVehicleStateRef = useRef<boolean>(true);

  // Input states
  const keysRef = useRef<{ [key: string]: boolean }>({});

  // UI Reactive States (for HUD & Modals)
  const [streetName, setStreetName] = useState<string>('Главная Автобаза КАМАЗ');
  const [fps, setFps] = useState<number>(60);
  const [, setHudTick] = useState(0);
  const [carCount, setCarCount] = useState<number>(45);
  const [pedCount, setPedCount] = useState<number>(40);
  const [isNight, setIsNight] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1.0);

  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [targetPoi, setTargetPoi] = useState<PointOfInterest | null>(null);

  // Modals
  const [showGarage, setShowGarage] = useState<boolean>(false);
  const [showMissions, setShowMissions] = useState<boolean>(false);
  const [showMultiplayer, setShowMultiplayer] = useState<boolean>(false);
  const [showFullMap, setShowFullMap] = useState<boolean>(false);

  // Multiplayer UI State
  const [mpStatus, setMpStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mpRoomId, setMpRoomId] = useState<string>('default');
  const [playerName, setPlayerName] = useState<string>('Дальнобойщик');
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // Initialize Multiplayer Client
  useEffect(() => {
    const mp = new MultiplayerClient(playerName, {
      onInit: (yourId, players, destructibles) => {
        setRemotePlayers(players);
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
      },
      onPlayerLeft: (playerId) => {
        setRemotePlayers((prev) => prev.filter((p) => p.id !== playerId));
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
      },
      onStatusChange: (status) => {
        setMpStatus(status);
      },
    });

    multiplayerRef.current = mp;
    mp.connect('default');

    return () => {
      mp.disconnect();
    };
  }, []);

  // Update InVehicle ref
  useEffect(() => {
    inVehicleStateRef.current = inVehicle;
  }, [inVehicle]);

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

      keysRef.current[e.code] = true;

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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    rendererRef.current = new GameRenderer(ctx);

    let animationFrameId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let lastHudUpdate = performance.now();
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
      if (now - lastHudUpdate > 100) {
        setHudTick((tick) => tick + 1);
        lastHudUpdate = now;
      }

      // 1. Update Traffic Lights Cycles
      cityMapRef.current.updateTrafficLights(delta);

      // 2. Process Player Inputs & Physics
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

      // 3. Update NPC Traffic & Pedestrians AI
      const playerPos = isCar ? { x: v.x, y: v.y } : { x: char.x, y: char.y };
      trafficRef.current.updateTraffic(delta, isCar ? v : undefined);
      trafficRef.current.updatePedestrians(delta, playerPos.x, playerPos.y, v.isHonking);

      // 4. Resolve Collisions (Vehicles vs Props vs Pedestrians vs Buildings)
      physicsRef.current.resolveAllCollisions(
        isCar ? [v, ...trafficRef.current.npcVehicles] : trafficRef.current.npcVehicles,
        cityMapRef.current.destructibles,
        trafficRef.current.pedestrians,
        cityMapRef.current.buildings,
        (propId) => {
          multiplayerRef.current?.sendObjectDestroyed(propId);
        },
        delta,
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

      // 5. Update Particles
      physicsRef.current.updateParticles(delta);

      // 6. Update Missions & Check Arrival
      const missionResult = missionsRef.current.update(delta);
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
          v.health = Math.min(100, v.health + delta * 25);
          if (Math.random() < 0.2) {
            physicsRef.current.spawnSparks(v.x, v.y);
          }
        }
      }

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

      // 9. Render Canvas Scene
      if (rendererRef.current) {
        rendererRef.current.zoom = zoom;
        rendererRef.current.frameDelta = delta;
        rendererRef.current.render(
          canvas.width,
          canvas.height,
          cityMapRef.current,
          v,
          char,
          isCar,
          trafficRef.current.npcVehicles,
          // Interpolated: the network stream is 20Hz, the display is not.
          multiplayerRef.current?.getInterpolatedPlayers() || [],
          trafficRef.current.pedestrians,
          cityMapRef.current.destructibles,
          physicsRef.current.particles,
          physicsRef.current.skidMarks,
          targetPoi
        );
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [zoom, targetPoi]);

  // Handle Window Resize for Canvas
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
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
      {/* 2D Top-Down Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full cursor-crosshair" />

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
          const next = !isMuted;
          setIsMuted(next);
          sound.setMuted(next);
        }}
        zoom={zoom}
        onZoomIn={() => setZoom((prev) => Math.min(1.5, prev + 0.1))}
        onZoomOut={() => setZoom((prev) => Math.max(0.6, prev - 0.1))}
        playerVehicle={inVehicle ? playerVehicleRef.current : null}
        playerChar={playerCharRef.current}
        inVehicle={inVehicle}
        cityMap={cityMapRef.current}
        trafficCars={trafficRef.current.npcVehicles}
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
      />

      {/* Virtual Controls for mobile touch */}
      <VirtualControls onInput={handleVirtualInput} />

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
          onUpdatePlayerName={(name) => {
            setPlayerName(name);
            playerCharRef.current.name = name;
            if (multiplayerRef.current) {
              multiplayerRef.current.playerName = name;
            }
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
          targetPoi={targetPoi}
          onClose={() => setShowFullMap(false)}
        />
      )}
    </div>
  );
}
