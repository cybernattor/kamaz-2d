import React from 'react';
import { Mission, PlayerCharacter, PointOfInterest, RemotePlayer, VehicleInstance } from '../types';
import { VEHICLE_CONFIGS } from '../game/vehicleConfigs';
import {
  Volume2,
  VolumeX,
  Sun,
  Moon,
  ZoomIn,
  ZoomOut,
  Wrench,
  Users,
  Compass,
  Radio,
  Car,
  Briefcase,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';
import { Minimap } from './Minimap';
import { CityMap } from '../game/cityMap';

interface HUDProps {
  streetName: string;
  fps: number;
  carCount: number;
  pedCount: number;
  isNight: boolean;
  onToggleDayNight: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  playerVehicle: VehicleInstance | null;
  playerChar: PlayerCharacter;
  inVehicle: boolean;
  cityMap: CityMap;
  trafficCars: VehicleInstance[];
  remotePlayers: RemotePlayer[];
  activeMission: Mission | null;
  targetPoi: PointOfInterest | null;
  onOpenMap: () => void;
  onOpenGarage: () => void;
  onOpenMissions: () => void;
  onOpenMultiplayer: () => void;
  onRepairVehicle: () => void;
  onToggleHeadlights: () => void;
  onToggleTurnSignal: (signal: 'left' | 'right' | 'hazard') => void;
  onToggleEnterExitVehicle: () => void;
  multiplayerStatus: 'disconnected' | 'connecting' | 'connected';
  onlineCount: number;
  isTouchDevice: boolean;
}

export const HUD: React.FC<HUDProps> = ({
  streetName,
  fps,
  carCount,
  pedCount,
  isNight,
  onToggleDayNight,
  isMuted,
  onToggleMute,
  zoom,
  onZoomIn,
  onZoomOut,
  playerVehicle,
  playerChar,
  inVehicle,
  cityMap,
  trafficCars,
  remotePlayers,
  activeMission,
  targetPoi,
  onOpenMap,
  onOpenGarage,
  onOpenMissions,
  onOpenMultiplayer,
  onRepairVehicle,
  onToggleHeadlights,
  onToggleTurnSignal,
  onToggleEnterExitVehicle,
  multiplayerStatus,
  onlineCount,
  isTouchDevice,
}) => {
  // Speedometer calculation
  const speedKmH = playerVehicle ? Math.round(Math.abs(playerVehicle.speed) * 3.6) : Math.round(playerChar.speed * 3.6);
  const gear = !playerVehicle
    ? 'FOOT'
    : playerVehicle.speed < -0.2
    ? 'R'
    : Math.abs(playerVehicle.speed) < 0.2
    ? 'P'
    : 'D';

  const vehicleConfig = playerVehicle ? VEHICLE_CONFIGS[playerVehicle.type] : null;
  const condition = playerVehicle ? Math.round(playerVehicle.health) : Math.round(playerChar.health);

  // Distance to Mission Target
  let distToTarget = 0;
  if (targetPoi) {
    const px = inVehicle && playerVehicle ? playerVehicle.x : playerChar.x;
    const py = inVehicle && playerVehicle ? playerVehicle.y : playerChar.y;
    distToTarget = Math.round(Math.hypot(targetPoi.x - px, targetPoi.y - py));
  }

  return (
    <div id="game-hud-root" className="absolute inset-0 pointer-events-none flex flex-col justify-between gap-2 p-2 pb-24 sm:p-3 sm:pb-3 md:p-4 md:pb-4 select-none overflow-hidden font-sans">
      {/* 1. TOP STATUS BAR */}
      <div id="hud-top-bar" className="relative min-h-[158px] w-full pointer-events-auto">
        {/* Left Side: Street Name + FPS + Stats */}
        <div className="w-[calc(100%-168px)] sm:w-[calc(100%-174px)] min-w-0 flex items-center gap-2 bg-slate-950/95 border border-slate-700/80 px-2.5 sm:px-3 py-2 rounded-xl shadow-lg">
          <div className="min-w-0 flex items-center gap-1.5 text-cyan-400 font-bold text-xs sm:text-sm tracking-wide">
            <Compass className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span className="font-mono truncate">{streetName}</span>
          </div>

          <div className="h-4 w-px bg-slate-700 mx-1" />

          <div className="hidden sm:flex items-center gap-1 text-xs text-emerald-400 font-mono">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>{fps} FPS</span>
          </div>

          <div className="h-4 w-px bg-slate-700 mx-1" />

          <div className="hidden sm:block text-xs text-slate-300 font-mono whitespace-nowrap">
            <span>{carCount} авто</span>
            <span className="mx-1.5 text-slate-500">•</span>
            <span>{pedCount} пеш.</span>
          </div>
        </div>

        {/* Center / Quick Controls Toggles */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 bg-slate-950/95 border border-slate-700/80 px-2 py-1.5 rounded-xl shadow-lg w-[calc(100%-168px)] sm:w-fit sm:max-w-[calc(100vw-190px)]">
          {/* Day / Night Toggle */}
          <button
            id="btn-toggle-day-night"
            onClick={onToggleDayNight}
            className="min-h-9 flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-amber-300 transition-colors cursor-pointer"
            title="Toggle Day/Night [T]"
          >
            {isNight ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isNight ? 'Night (00:00)' : 'Day (12:00)'}</span>
          </button>

          {/* Audio Mute Toggle */}
          <button
            id="btn-toggle-audio"
            onClick={onToggleMute}
            className="min-h-9 flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
            title="Toggle Audio"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
            <span>{isMuted ? 'Audio OFF' : 'Audio ON'}</span>
          </button>

          {/* Zoom In/Out */}
          <div className="flex items-center bg-slate-800/80 rounded-lg px-1 min-h-9">
            <button
              id="btn-zoom-out"
              onClick={onZoomOut}
              className="p-2 text-slate-300 hover:text-cyan-400 cursor-pointer"
              title="Zoom Out [-]"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-slate-400 px-1">{Math.round(zoom * 100)}%</span>
            <button
              id="btn-zoom-in"
              onClick={onZoomIn}
              className="p-2 text-slate-300 hover:text-cyan-400 cursor-pointer"
              title="Zoom In [+]"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Garage & Missions Action Buttons */}
          <button
            id="btn-open-garage"
            onClick={onOpenGarage}
            className="min-h-9 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow cursor-pointer transition-all"
          >
            <Car className="w-3.5 h-3.5" />
            <span>Гараж [G]</span>
          </button>

          <button
            id="btn-open-missions"
            onClick={onOpenMissions}
            className="min-h-9 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow cursor-pointer transition-all"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Задания [J]</span>
          </button>

          {/* Multiplayer Badge & Lobby Trigger */}
          <button
            id="btn-open-multiplayer"
            onClick={onOpenMultiplayer}
            className={`min-h-9 flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
              multiplayerStatus === 'connected'
                ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 hover:bg-emerald-900/60'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>
              {multiplayerStatus === 'connected' ? `Онлайн (${onlineCount + 1})` : 'Мультиплеер'}
            </span>
          </button>
        </div>

        {/* Top Right: Minimap Radar */}
        <div className="pointer-events-auto absolute top-0 right-0">
          <Minimap
            playerX={inVehicle && playerVehicle ? playerVehicle.x : playerChar.x}
            playerY={inVehicle && playerVehicle ? playerVehicle.y : playerChar.y}
            playerAngle={inVehicle && playerVehicle ? playerVehicle.angle : playerChar.angle}
            playerSpeed={inVehicle && playerVehicle ? playerVehicle.speed : playerChar.speed}
            cityMap={cityMap}
            trafficCars={trafficCars}
            remotePlayers={remotePlayers}
            targetPoi={targetPoi}
            onOpenFullMap={onOpenMap}
          />
        </div>
      </div>

      {/* 2. MIDDLE AREA (Active Mission HUD Overlay) */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-start gap-2 w-full my-1">
        {/* Active Mission HUD Card (if any) */}
        {activeMission && (
          <div
            id="active-mission-hud-card"
            className="pointer-events-auto bg-slate-950/95 border-2 border-amber-500/80 rounded-xl p-3 shadow-2xl w-full sm:max-w-sm"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                <Briefcase className="w-4 h-4 text-amber-400" />
                <span>ТЕКУЩЕЕ ЗАДАНИЕ</span>
              </div>
              {activeMission.currentSeconds !== undefined && (
                <div className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  ⏱ {Math.floor(activeMission.currentSeconds / 60)}:
                  {String(Math.floor(activeMission.currentSeconds % 60)).padStart(2, '0')}
                </div>
              )}
            </div>

            <h4 className="text-sm font-bold text-slate-100 mb-1">{activeMission.titleRu}</h4>
            <p className="text-xs text-slate-300 leading-relaxed mb-2">{activeMission.descriptionRu}</p>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
              <span className="text-emerald-400 font-mono font-bold">
                +{activeMission.rewardMoney.toLocaleString()} ₽
              </span>
              {targetPoi && (
                <span className="text-cyan-300 font-mono">
                  Дистанция: {distToTarget} м
                </span>
              )}
            </div>
          </div>
        )}

      </div>

      {/* 3. BOTTOM ROW: Controls Legend (Left) + Driving Instrument Pod (Right - Exact Screenshot Match!) */}
      <div id="hud-bottom-row" className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-2 w-full pointer-events-auto">
        {/* Bottom-Left Controls Helper (Screenshot Match) */}
        <div
          id="hud-controls-legend"
          className="bg-slate-950/95 border border-slate-800/80 rounded-xl p-2.5 sm:p-3 shadow-xl w-full sm:max-w-md max-h-24 sm:max-h-none overflow-y-auto sm:overflow-visible text-[11px] font-mono text-slate-300 space-y-1"
        >
          <div className="text-xs font-bold text-cyan-400 mb-1 tracking-wider uppercase">Управление</div>
          {isTouchDevice ? (
            <div className="grid grid-cols-1 gap-y-1">
              <div>Джойстик снизу — руль, газ и тормоз</div>
              <div>Кнопка <span className="text-amber-400 font-bold">[E]</span> в HUD — сесть / выйти</div>
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>
              <span className="text-amber-400 font-bold">WASD / 🠹🠸🠺🠻</span> Управление
            </div>
            <div>
              <span className="text-amber-400 font-bold">[E]</span> Сесть / Выйти
            </div>
            <div>
              <span className="text-amber-400 font-bold">[Q / Z]</span> Поворотники
            </div>
            <div>
              <span className="text-amber-400 font-bold">[X]</span> Аварийка
            </div>
            <div>
              <span className="text-amber-400 font-bold">[SPACE]</span> Ручник / Дрифт
            </div>
            <div>
              <span className="text-amber-400 font-bold">[H]</span> Гудок / Сигнал
            </div>
            <div>
              <span className="text-amber-400 font-bold">[L]</span> Фары (Ближний/Дальний)
            </div>
            <div>
              <span className="text-amber-400 font-bold">[J]</span> Сирена (Скорая/ДПС)
            </div>
            <div>
              <span className="text-amber-400 font-bold">[R]</span> Починить машину
            </div>
            <div>
              <span className="text-amber-400 font-bold">[T]</span> День / Ночь
            </div>
          </div>
          )}
        </div>

        {/* Bottom-Right Driving Actions + Instrument Pod */}
        <div className="flex flex-col items-stretch gap-2 w-full sm:w-80 max-w-full">
          <button
            id="btn-enter-exit-vehicle"
            onClick={onToggleEnterExitVehicle}
            className="w-full min-h-11 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2 rounded-xl shadow-xl transition-transform active:scale-95 cursor-pointer"
          >
            <Car className="w-5 h-5" />
            <span className="font-mono text-xs">{inVehicle ? '[E] Выйти из авто' : '[E] Сесть в КАМАЗ / авто'}</span>
          </button>

          <div
            id="hud-instrument-pod"
            className="bg-slate-950/95 border-2 border-slate-700/80 rounded-2xl p-3 shadow-2xl w-full space-y-2.5"
          >
          {/* Top Row: Speedometer + Gear + Vehicle Name */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold font-mono text-cyan-400 tracking-tight drop-shadow-[0_0_10px_#22d3ee]">
                {speedKmH}
              </span>
              <span className="text-xs font-mono text-slate-400 font-bold">КМ/Ч</span>
            </div>

            <div className="text-right">
              <div className="text-sm font-bold text-slate-100">
                {vehicleConfig ? vehicleConfig.nameRu : playerChar.name}
              </div>
              <div className="text-xs font-mono text-amber-400">
                Передача: <span className="font-bold text-cyan-300">{gear}</span>
              </div>
            </div>
          </div>

          {/* Condition / Durability Health Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 flex items-center gap-1">
                <Wrench className="w-3.5 h-3.5 text-emerald-400" />
                Состояние (Condition):
              </span>
              <span
                className={`font-bold ${
                  condition > 60
                    ? 'text-emerald-400'
                    : condition > 30
                    ? 'text-amber-400'
                    : 'text-rose-500 animate-pulse'
                }`}
              >
                {condition}%
              </span>
            </div>

            {/* Health Track */}
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  condition > 60
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : condition > 30
                    ? 'bg-gradient-to-r from-amber-500 to-orange-400'
                    : 'bg-gradient-to-r from-rose-600 to-red-500'
                }`}
                style={{ width: `${Math.max(0, condition)}%` }}
              />
            </div>
          </div>

          {/* Quick Repair Button */}
          <button
            id="btn-repair-car"
            onClick={onRepairVehicle}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-mono font-bold py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 transition-colors cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Ремонт авто [R]</span>
          </button>

          {/* Headlights & Turn Signal Controls Bar (Screenshot Match) */}
          <div className="flex items-center justify-between gap-1.5 pt-1">
            {/* Turn Signal Left */}
            <button
              id="btn-turn-left"
              onClick={() => onToggleTurnSignal('left')}
              className={`flex-1 min-h-10 py-1 px-1.5 rounded text-xs font-mono font-bold border transition-colors cursor-pointer text-center ${
                playerVehicle?.turnSignal === 'left'
                  ? 'bg-amber-500 text-black border-amber-400 animate-pulse'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              ← Q
            </button>

            {/* Headlights Mode Toggle */}
            <button
              id="btn-toggle-headlights"
              onClick={onToggleHeadlights}
              className={`flex-[2] min-h-10 py-1 px-2 rounded text-xs font-mono font-bold border transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                playerVehicle && playerVehicle.headlights > 0
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>
                {playerVehicle?.headlights === 2
                  ? 'Дальний (L)'
                  : playerVehicle?.headlights === 1
                  ? 'Ближний (L)'
                  : 'Фары Выкл (L)'}
              </span>
            </button>

            {/* Turn Signal Right */}
            <button
              id="btn-turn-right"
              onClick={() => onToggleTurnSignal('right')}
              className={`flex-1 min-h-10 py-1 px-1.5 rounded text-xs font-mono font-bold border transition-colors cursor-pointer text-center ${
                playerVehicle?.turnSignal === 'right'
                  ? 'bg-amber-500 text-black border-amber-400 animate-pulse'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              Z →
            </button>

            {/* Hazard Lights (X) */}
            <button
              id="btn-hazard-lights"
              onClick={() => onToggleTurnSignal('hazard')}
              className={`min-h-10 py-1 px-2 rounded text-xs font-mono font-bold border transition-colors cursor-pointer ${
                playerVehicle?.turnSignal === 'hazard'
                  ? 'bg-red-600 text-white border-red-400 animate-ping'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
              title="Hazard Lights [X]"
            >
              ⚠ X
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
