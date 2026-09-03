import React, { useEffect, useRef } from 'react';
import { PointOfInterest, RemotePlayer, VehicleInstance } from '../types';
import { CityMap, WORLD_SIZE } from '../game/cityMap';

interface MinimapProps {
  playerX: number;
  playerY: number;
  playerAngle: number;
  playerSpeed: number;
  cityMap: CityMap;
  trafficCars: VehicleInstance[];
  remotePlayers: RemotePlayer[];
  targetPoi: PointOfInterest | null;
  onOpenFullMap: () => void;
}

const MAP_SIZE = 150;
const RADAR_RANGE = 700;

export const Minimap: React.FC<MinimapProps> = ({
  playerX,
  playerY,
  playerAngle,
  playerSpeed,
  cityMap,
  trafficCars,
  remotePlayers,
  targetPoi,
  onOpenFullMap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef({ x: playerX, y: playerY, angle: playerAngle, speed: playerSpeed, updatedAt: performance.now() });
  const cityMapRef = useRef(cityMap);
  const trafficCarsRef = useRef(trafficCars);
  const remotePlayersRef = useRef(remotePlayers);
  const targetPoiRef = useRef(targetPoi);

  // Keep the animation loop independent from React's HUD updates. The game
  // loop changes positions every frame, while the canvas itself is stable.
  playerRef.current = { x: playerX, y: playerY, angle: playerAngle, speed: playerSpeed, updatedAt: performance.now() };
  cityMapRef.current = cityMap;
  trafficCarsRef.current = trafficCars;
  remotePlayersRef.current = remotePlayers;
  targetPoiRef.current = targetPoi;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = MAP_SIZE * dpr;
    canvas.height = MAP_SIZE * dpr;
    canvas.style.width = `${MAP_SIZE}px`;
    canvas.style.height = `${MAP_SIZE}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const staticWorldScale = MAP_SIZE / RADAR_RANGE;
    const staticCanvas = document.createElement('canvas');
    staticCanvas.width = Math.ceil(WORLD_SIZE * staticWorldScale * dpr);
    staticCanvas.height = Math.ceil(WORLD_SIZE * staticWorldScale * dpr);
    const staticContext = staticCanvas.getContext('2d');
    let staticMap: CityMap | null = null;

    const rebuildStatic = (map: CityMap) => {
      if (!staticContext) return;
      staticContext.setTransform(dpr * staticWorldScale, 0, 0, dpr * staticWorldScale, 0, 0);
      staticContext.clearRect(0, 0, WORLD_SIZE, WORLD_SIZE);
      for (const zone of map.decorations) {
        staticContext.fillStyle = zone.type === 'water' || zone.type === 'beach'
          ? 'rgba(14, 116, 144, 0.5)'
          : zone.type === 'industrial' || zone.type === 'airport'
          ? 'rgba(82, 82, 91, 0.45)'
          : zone.type === 'desert'
          ? 'rgba(146, 84, 24, 0.52)'
          : zone.type === 'hills'
          ? 'rgba(54, 83, 20, 0.5)'
          : zone.type === 'rail'
          ? 'rgba(71, 85, 105, 0.5)'
          : zone.type === 'plaza'
          ? 'rgba(30, 64, 175, 0.42)'
          : 'rgba(22, 101, 52, 0.5)';
        staticContext.fillRect(zone.x - zone.width / 2, zone.y - zone.height / 2, zone.width, zone.height);
      }
      staticContext.lineCap = 'round';
      staticContext.lineJoin = 'round';
      for (const road of map.roads) {
        if (road.points.length < 2) continue;
        staticContext.strokeStyle = road.roadClass === 'dirt' ? 'rgba(180, 126, 58, 0.9)' : road.roadClass === 'highway' ? 'rgba(148, 163, 184, 0.9)' : 'rgba(71, 85, 105, 0.78)';
        staticContext.lineWidth = road.roadClass === 'dirt' ? 2 : road.lanesPerDirection === 2 ? 5 : 3;
        staticContext.beginPath();
        road.points.forEach((point, index) => {
          if (index === 0) staticContext.moveTo(point.x, point.y); else staticContext.lineTo(point.x, point.y);
        });
        staticContext.stroke();
      }
      for (const route of map.scenicRoutes) {
        if (route.points.length < 2) continue;
        staticContext.strokeStyle = 'rgba(214, 179, 122, 0.8)';
        staticContext.lineWidth = 2.5;
        staticContext.beginPath();
        staticContext.moveTo(route.points[0].x, route.points[0].y);
        route.points.slice(1).forEach((point) => staticContext.lineTo(point.x, point.y));
        staticContext.stroke();
      }
      staticMap = map;
    };

    const smooth = { ...playerRef.current };
    let animationFrameId = 0;
    let lastFrame = performance.now();
    let lastDrawAt = 0;

    const lerpAngle = (from: number, to: number, amount: number) => {
      const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
      return from + difference * amount;
    };

    const draw = (now: number) => {
      if (now - lastDrawAt < 66) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }
      lastDrawAt = now;
      const frameDelta = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      const follow = 1 - Math.exp(-12 * frameDelta);
      const target = playerRef.current;
      const age = Math.min((now - target.updatedAt) / 1000, 0.65);
      const estimatedX = target.x + Math.cos(target.angle) * target.speed * 60 * age;
      const estimatedY = target.y + Math.sin(target.angle) * target.speed * 60 * age;
      smooth.x += (estimatedX - smooth.x) * follow;
      smooth.y += (estimatedY - smooth.y) * follow;
      smooth.angle = lerpAngle(smooth.angle, target.angle, follow);

      const map = cityMapRef.current;
      const toRadar = (wx: number, wy: number) => ({
        x: ((wx - smooth.x) / RADAR_RANGE) * (MAP_SIZE / 2) + MAP_SIZE / 2,
        y: ((wy - smooth.y) / RADAR_RANGE) * (MAP_SIZE / 2) + MAP_SIZE / 2,
      });

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, MAP_SIZE, MAP_SIZE);
      ctx.clip();

      // Radar grid.
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.375, 0, Math.PI * 2);
      ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.5, 0, Math.PI * 2);
      ctx.moveTo(0, MAP_SIZE / 2);
      ctx.lineTo(MAP_SIZE, MAP_SIZE / 2);
      ctx.moveTo(MAP_SIZE / 2, 0);
      ctx.lineTo(MAP_SIZE / 2, MAP_SIZE);
      ctx.stroke();

      if (map !== staticMap) rebuildStatic(map);
      if (staticContext) {
        const sourceX = Math.max(0, Math.min(WORLD_SIZE - RADAR_RANGE, smooth.x - RADAR_RANGE / 2));
        const sourceY = Math.max(0, Math.min(WORLD_SIZE - RADAR_RANGE, smooth.y - RADAR_RANGE / 2));
        ctx.drawImage(
          staticCanvas,
          sourceX * staticWorldScale * dpr,
          sourceY * staticWorldScale * dpr,
          RADAR_RANGE * staticWorldScale * dpr,
          RADAR_RANGE * staticWorldScale * dpr,
          0,
          0,
          MAP_SIZE,
          MAP_SIZE
        );
      }

      // Traffic dots.
      for (const car of trafficCarsRef.current) {
        if (car.health <= 0) continue;
        const pos = toRadar(car.x, car.y);
        if (pos.x < 0 || pos.x > MAP_SIZE || pos.y < 0 || pos.y > MAP_SIZE) continue;
        ctx.fillStyle = car.isBraking ? '#fb7185' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Other online players, distinct from NPC traffic and the mission
      // marker so a squadmate reads at a glance on a busy radar.
      for (const rp of remotePlayersRef.current) {
        const pos = toRadar(rp.x, rp.y);
        if (pos.x < -6 || pos.x > MAP_SIZE + 6 || pos.y < -6 || pos.y > MAP_SIZE + 6) continue;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(rp.angle + Math.PI / 2);
        ctx.fillStyle = '#e879f9';
        ctx.shadowColor = '#e879f9';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(4, 4);
        ctx.lineTo(0, 2);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Mission target.
      const poi = targetPoiRef.current;
      if (poi) {
        const pos = toRadar(poi.x, poi.y);
        if (pos.x >= -10 && pos.x <= MAP_SIZE + 10 && pos.y >= -10 && pos.y <= MAP_SIZE + 10) {
          const pulse = 4 + Math.sin(now / 180) * 1.4;
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Player arrow remains fixed in the center while its heading eases.
      ctx.save();
      ctx.translate(MAP_SIZE / 2, MAP_SIZE / 2);
      ctx.rotate(smooth.angle + Math.PI / 2);
      ctx.fillStyle = '#22d3ee';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.restore();
      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div
      id="hud-minimap-container"
      className="relative bg-slate-950/95 border-2 border-slate-700/80 rounded-xl overflow-hidden shadow-2xl p-1"
      style={{ width: MAP_SIZE + 8, height: MAP_SIZE + 8 }}
    >
      <div className="relative w-full h-full bg-slate-900/90 rounded-lg overflow-hidden">
        <canvas ref={canvasRef} aria-label="Миникарта района" className="block w-full h-full" />
        <button
          id="btn-open-full-map"
          onClick={onOpenFullMap}
          className="absolute bottom-1 right-1 min-h-7 bg-slate-900/90 hover:bg-slate-800 text-[10px] text-cyan-300 font-mono px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
          title="Открыть карту [M]"
        >
          <span>Карта [M]</span>
        </button>
      </div>
    </div>
  );
};
