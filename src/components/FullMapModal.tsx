import React, { useEffect, useRef, useState } from 'react';
import { PointOfInterest, RemotePlayer, VehicleInstance } from '../types';
import { CityMap, WORLD_SIZE } from '../game/cityMap';
import { GameRenderer } from '../game/renderer';
import { X, Compass } from 'lucide-react';

const FULL_MAP_SIZE = 580;

interface FullMapCanvasProps {
  playerX: number;
  playerY: number;
  playerAngle: number;
  playerSpeed: number;
  cityMap: CityMap;
  trafficCars: VehicleInstance[];
  remotePlayers: RemotePlayer[];
  targetPoi: PointOfInterest | null;
  selectedPoi: PointOfInterest | null;
  zoom: number;
  center: { x: number; y: number };
}

const FullMapCanvas: React.FC<FullMapCanvasProps> = ({
  playerX,
  playerY,
  playerAngle,
  playerSpeed,
  cityMap,
  trafficCars,
  remotePlayers,
  targetPoi,
  selectedPoi,
  zoom,
  center,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef({ x: playerX, y: playerY, angle: playerAngle, speed: playerSpeed, updatedAt: performance.now() });
  const cityMapRef = useRef(cityMap);
  const trafficCarsRef = useRef(trafficCars);
  const remotePlayersRef = useRef(remotePlayers);
  const targetPoiRef = useRef(targetPoi);
  const selectedPoiRef = useRef(selectedPoi);
  const viewRef = useRef({ zoom, center });

  // Props are refreshed by React at HUD cadence, but the simulation mutates
  // vehicle objects every frame. The canvas loop reads those live objects and
  // keeps the map independent from HUD state updates.
  playerRef.current = { x: playerX, y: playerY, angle: playerAngle, speed: playerSpeed, updatedAt: performance.now() };
  cityMapRef.current = cityMap;
  trafficCarsRef.current = trafficCars;
  remotePlayersRef.current = remotePlayers;
  targetPoiRef.current = targetPoi;
  selectedPoiRef.current = selectedPoi;
  viewRef.current = { zoom, center };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let displaySize = FULL_MAP_SIZE;
    let lastDrawAt = 0;
    const staticRenderer = new GameRenderer(ctx);
    let staticMap: CityMap | null = null;
    let staticScene: HTMLCanvasElement | null = null;

    const resize = () => {
      displaySize = Math.max(1, Math.min(FULL_MAP_SIZE, canvas.clientWidth || FULL_MAP_SIZE));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(displaySize * dpr);
      canvas.height = Math.round(displaySize * dpr);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const draw = (now: number) => {
      if (now - lastDrawAt < 66) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }
      lastDrawAt = now;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = displaySize / FULL_MAP_SIZE;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, FULL_MAP_SIZE, FULL_MAP_SIZE);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, FULL_MAP_SIZE, FULL_MAP_SIZE);

      const map = cityMapRef.current;
      const view = viewRef.current;
      const toMapCoord = (value: number, axis: 'x' | 'y') =>
        ((value - view.center[axis]) / WORLD_SIZE) * FULL_MAP_SIZE * view.zoom + FULL_MAP_SIZE / 2;

      if (map !== staticMap) {
        staticScene = staticRenderer.getStaticScene(map);
        staticMap = map;
      }
      if (staticScene) {
        const size = FULL_MAP_SIZE * view.zoom;
        ctx.drawImage(staticScene, 0, 0, WORLD_SIZE, WORLD_SIZE,
          FULL_MAP_SIZE / 2 - (view.center.x / WORLD_SIZE) * size,
          FULL_MAP_SIZE / 2 - (view.center.y / WORLD_SIZE) * size, size, size);
      }
      for (const district of map.districts) {
        const x = toMapCoord(district.x - district.width / 2, 'x');
        const y = toMapCoord(district.y - district.height / 2, 'y');
        ctx.fillStyle = `${district.accent}bb`;
        ctx.font = 'bold 12px "JetBrains Mono", sans-serif';
        ctx.fillText(district.name, x + 12, y + 20);
      }

      // POI emphasis is dynamic because the selected mission can change.
      for (const poi of map.pois) {
        const x = toMapCoord(poi.x - poi.width / 2, 'x');
        const y = toMapCoord(poi.y - poi.height / 2, 'y');
        const width = (poi.width / WORLD_SIZE) * FULL_MAP_SIZE * view.zoom;
        const height = (poi.height / WORLD_SIZE) * FULL_MAP_SIZE * view.zoom;
        const highlighted = targetPoiRef.current?.id === poi.id || selectedPoiRef.current?.id === poi.id;
        ctx.fillStyle = highlighted ? 'rgba(234, 179, 8, 0.55)' : 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = highlighted ? '#facc15' : poi.color;
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
        if (selectedPoiRef.current?.id === poi.id) {
          ctx.fillStyle = '#fef08a';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(poi.nameRu, toMapCoord(poi.x, 'x'), y - 8);
        }
      }

      // Live traffic positions prevent the old two-times-per-second React
      // marker jumps. Dead or destroyed vehicles stay hidden.
      for (const car of trafficCarsRef.current) {
        if (car.health <= 0) continue;
        ctx.fillStyle = car.isBraking ? '#fb7185' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(toMapCoord(car.x, 'x'), toMapCoord(car.y, 'y'), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Other online players get their own marker + name tag so a squadmate
      // is easy to spot next to NPC traffic and the mission target.
      for (const rp of remotePlayersRef.current) {
        const x = toMapCoord(rp.x, 'x');
        const y = toMapCoord(rp.y, 'y');
        if (x < -20 || x > FULL_MAP_SIZE + 20 || y < -20 || y > FULL_MAP_SIZE + 20) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rp.angle + Math.PI / 2);
        ctx.fillStyle = '#e879f9';
        ctx.shadowColor = '#e879f9';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(6, 6);
        ctx.lineTo(0, 3);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#f5d0fe';
        ctx.font = 'bold 10px "JetBrains Mono", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(rp.name, x, y - 14);
      }

      // Extrapolate the player between HUD snapshots using its current
      // velocity, then ease the visible marker to the estimate.
      const player = playerRef.current;
      const age = Math.min((now - player.updatedAt) / 1000, 0.65);
      const estimatedX = player.x + Math.cos(player.angle) * player.speed * 60 * age;
      const estimatedY = player.y + Math.sin(player.angle) * player.speed * 60 * age;
      const playerXOnMap = toMapCoord(estimatedX, 'x');
      const playerYOnMap = toMapCoord(estimatedY, 'y');
      ctx.save();
      ctx.translate(playerXOnMap, playerYOnMap);
      ctx.rotate(player.angle + Math.PI / 2);
      ctx.fillStyle = '#22d3ee';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(7, 7);
      ctx.lineTo(0, 4);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Subtle grid gives the map a stable visual reference while moving.
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.09)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= FULL_MAP_SIZE; i += 58) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, FULL_MAP_SIZE);
        ctx.moveTo(0, i);
        ctx.lineTo(FULL_MAP_SIZE, i);
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Полная карта города" className="block h-full w-full" />;
};

interface FullMapModalProps {
  playerX: number;
  playerY: number;
  playerAngle: number;
  playerSpeed: number;
  cityMap: CityMap;
  trafficCars: VehicleInstance[];
  remotePlayers: RemotePlayer[];
  targetPoi: PointOfInterest | null;
  onClose: () => void;
}

export const FullMapModal: React.FC<FullMapModalProps> = ({
  playerX,
  playerY,
  playerAngle,
  playerSpeed,
  cityMap,
  trafficCars,
  remotePlayers,
  targetPoi,
  onClose,
}) => {
  const [selectedPoi, setSelectedPoi] = useState<PointOfInterest | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });

  return (
    <div
      id="modal-fullmap-backdrop"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-slate-950/85 backdrop-blur-md p-2 sm:p-4"
    >
      <div
        id="modal-fullmap-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-fullmap-title"
        className="my-0.5 sm:my-4 bg-slate-900 border-2 border-slate-700 rounded-2xl max-w-4xl w-full max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 id="modal-fullmap-title" className="text-lg font-bold text-slate-100">Карта Города и Логистических Зон</h3>
              <p className="text-xs text-slate-400">6 районов · трассы, порт, ж/д, аэропорт, карьер и лесные маршруты</p>
            </div>
          </div>

          <button
            id="btn-close-fullmap"
            onClick={onClose}
            aria-label="Закрыть карту"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 overflow-hidden p-3 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6 items-center justify-center">
          {/* Map Display Viewport */}
          <div className="md:col-span-8 flex justify-center min-w-0">
            <div
              className="relative bg-slate-950 border-2 border-slate-700 rounded-xl overflow-hidden shadow-inner w-[min(100%,45dvh)] md:w-[min(100%,calc(100dvh-12rem))] max-w-[580px] aspect-square"
            >
              <div className="absolute right-2 top-2 z-10 flex overflow-hidden rounded-lg border border-slate-600 bg-slate-950/90 shadow">
                <button aria-label="Увеличить карту" onClick={() => setZoom((value) => Math.min(4, value * 1.5))} className="h-9 w-9 text-lg text-white hover:bg-slate-700">+</button>
                <button aria-label="Уменьшить карту" onClick={() => setZoom((value) => Math.max(1, value / 1.5))} className="h-9 w-9 border-l border-slate-700 text-lg text-white hover:bg-slate-700">−</button>
                <button aria-label="Показать весь город" onClick={() => { setZoom(1); setCenter({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 }); setSelectedPoi(null); }} className="border-l border-slate-700 px-2 text-[10px] text-cyan-200 hover:bg-slate-700">Весь город</button>
              </div>
              <FullMapCanvas
                playerX={playerX}
                playerY={playerY}
                playerAngle={playerAngle}
                playerSpeed={playerSpeed}
                cityMap={cityMap}
                trafficCars={trafficCars}
                remotePlayers={remotePlayers}
                targetPoi={targetPoi}
                selectedPoi={selectedPoi}
                zoom={zoom}
                center={center}
              />
            </div>
          </div>

          {/* Right Column: POI Directory & Legend */}
          <div className="md:col-span-4 space-y-3 max-h-[25dvh] md:max-h-[calc(100dvh-12rem)] overflow-y-auto pr-1 text-xs font-mono">
            <div className="text-slate-400 uppercase tracking-wider text-[11px] font-bold">
              Объекты Города ({cityMap.pois.length})
            </div>

            {cityMap.pois.map((poi) => (
              <button
                key={poi.id}
                onClick={() => { setSelectedPoi(poi); setCenter({ x: poi.x, y: poi.y }); setZoom((value) => Math.max(value, 2)); }}
                aria-pressed={selectedPoi?.id === poi.id}
                className={`block w-full p-2.5 rounded-lg border text-left space-y-1 ${selectedPoi?.id === poi.id ? 'bg-amber-950/50 border-amber-500' : 'bg-slate-950/80 border-slate-800 hover:border-slate-600'}`}
              >
                <div className="font-bold text-slate-200 flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: poi.color }} />
                  <span>{poi.nameRu}</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans leading-tight">{poi.description}</p>
              </button>
            ))}
            <div className="rounded-lg border border-slate-700 bg-slate-950/95 p-3 space-y-2 text-[11px] text-slate-300">
              <div className="font-bold uppercase tracking-wide text-slate-400">Обозначения</div>
              <div className="flex items-center gap-2"><span className="text-cyan-400">▲</span> Вы</div>
              <div className="flex items-center gap-2"><span className="text-amber-400">●</span> Трафик</div>
              <div className="flex items-center gap-2"><span className="text-fuchsia-400">▲</span> Игроки онлайн</div>
              <div className="flex items-center gap-2"><span className="text-yellow-300">●</span> Цель задания / выбранный объект</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
