import React, { useState } from 'react';
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
  Car,
  Briefcase,
  Lightbulb,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Minimap } from './Minimap';
import { NetworkFeed, FeedEvent } from './NetworkFeed';
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
  feedEvents: FeedEvent[];
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
  feedEvents,
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

  // Controls legend starts collapsed to a one-line strip — the full key
  // reference is a click away instead of permanently eating a fifth of the
  // screen's height.
  const [showControlsHelp, setShowControlsHelp] = useState(false);

  // On touch, every instrument/action that used to live in a tall bottom
  // "instrument pod" has moved into the compact quickbar right under the
  // top bar (see hud-touch-quickbar below) - the bottom band renders
  // nothing at all for touch now, so the on-screen wheel/pedals (a
  // separately-positioned fixed layer) never compete with HUD chrome for
  // the same strip of screen. Only a small gap is kept so toast messages
  // don't visually kiss the pedals.
  const bottomReserveClass = isTouchDevice ? 'pb-4' : 'pb-2.5';

  return (
    <div
      id="game-hud-root"
      className={`absolute inset-0 pointer-events-none flex flex-col justify-between gap-1.5 p-2 sm:p-2.5 ${bottomReserveClass} select-none overflow-hidden font-sans`}
    >
      {/* 1. TOP STATUS BAR — a single compact row; the minimap reserves space on the right */}
      <div id="hud-top-bar" className="relative w-full pointer-events-auto">
        <div className="flex flex-wrap items-center gap-1.5 pr-[126px]">
          {/* Street Name + FPS + Stats */}
          <div className="min-w-0 flex-1 flex items-center gap-1.5 bg-slate-950/95 border border-slate-700/80 px-2.5 py-1.5 rounded-lg shadow-lg">
            <div className="min-w-0 flex items-center gap-1.5 text-cyan-400 font-bold text-xs tracking-wide">
              <Compass className="w-3.5 h-3.5 text-cyan-400 animate-pulse shrink-0" />
              <span className="font-mono truncate">{streetName}</span>
            </div>

            <div className="hidden sm:block h-4 w-px bg-slate-700 mx-0.5" />

            <div className="hidden sm:flex items-center gap-1 text-xs text-emerald-400 font-mono shrink-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>{fps}</span>
            </div>

            <div className="hidden sm:block h-4 w-px bg-slate-700 mx-0.5" />

            <div className="hidden sm:block text-xs text-slate-400 font-mono whitespace-nowrap shrink-0">
              <span>{carCount}🚗</span>
              <span className="mx-1">{pedCount}🚶</span>
            </div>
          </div>

          {/* Quick Controls Toggles — icon-only with a hover tooltip, so the
              whole cluster stays compact instead of spelling everything out */}
          <div className="flex items-center gap-1 bg-slate-950/95 border border-slate-700/80 px-1 py-1 rounded-lg shadow-lg shrink-0">
            <button
              id="btn-toggle-day-night"
              onClick={onToggleDayNight}
              className={`${isTouchDevice ? 'min-h-11 min-w-11' : 'min-h-8 min-w-8'} flex items-center justify-center rounded-md bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer`}
              title={isNight ? 'Ночь — переключить [T]' : 'День — переключить [T]'}
              aria-label="Переключить день или ночь"
            >
              {isNight ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
            </button>

            <button
              id="btn-toggle-audio"
              onClick={onToggleMute}
              className={`${isTouchDevice ? 'min-h-11 min-w-11' : 'min-h-8 min-w-8'} flex items-center justify-center rounded-md bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer`}
              title={isMuted ? 'Звук выключен — включить' : 'Звук включён — выключить'}
              aria-label="Переключить звук"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
            </button>

            <div className="flex items-center bg-slate-800/80 rounded-md">
              <button
                id="btn-zoom-out"
                onClick={onZoomOut}
                className={`${isTouchDevice ? 'min-h-11 min-w-11' : 'min-h-8 min-w-7'} flex items-center justify-center text-slate-300 hover:text-cyan-400 cursor-pointer`}
                title="Уменьшить [-]"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="hidden sm:inline text-[10px] font-mono text-slate-400 px-0.5">{Math.round(zoom * 100)}%</span>
              <button
                id="btn-zoom-in"
                onClick={onZoomIn}
                className={`${isTouchDevice ? 'min-h-11 min-w-11' : 'min-h-8 min-w-7'} flex items-center justify-center text-slate-300 hover:text-cyan-400 cursor-pointer`}
                title="Увеличить [+]"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              id="btn-open-garage"
              onClick={onOpenGarage}
              className="min-h-8 flex items-center gap-1 px-2 rounded-md bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow cursor-pointer transition-all"
              title="Гараж [G]"
              aria-label="Открыть гараж"
            >
              <Car className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold font-mono">G</span>
            </button>

            <button
              id="btn-open-missions"
              onClick={onOpenMissions}
              className="min-h-8 flex items-center gap-1 px-2 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow cursor-pointer transition-all"
              title="Задания [J]"
              aria-label="Открыть задания"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold font-mono">J</span>
            </button>

            <button
              id="btn-open-multiplayer"
              onClick={onOpenMultiplayer}
              className={`min-h-8 flex items-center gap-1 px-2 rounded-md border transition-colors cursor-pointer ${
                multiplayerStatus === 'connected'
                  ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 hover:bg-emerald-900/60'
                  : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title={multiplayerStatus === 'connected' ? `Онлайн (${onlineCount + 1})` : 'Мультиплеер'}
              aria-label="Открыть мультиплеер"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold font-mono">
                {multiplayerStatus === 'connected' ? onlineCount + 1 : '—'}
              </span>
            </button>
          </div>
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

      {/* Touch-only compact quickbar: speed/gear/condition readout plus the
          actions that used to live in the big bottom instrument pod
          (enter/exit, headlights, turn signals, hazard, repair). Sitting
          right under the top bar instead of stacked above the pedals keeps
          the entire bottom strip free for the wheel/pedals and stops the
          HUD from eating into the driving view. */}
      {isTouchDevice && (
        <div
          id="hud-touch-quickbar"
          className="pointer-events-auto flex flex-wrap items-center gap-1.5"
        >
          <div className="flex items-center gap-1.5 bg-slate-950/95 border border-slate-700/80 rounded-lg px-2.5 py-1.5 shadow-lg font-mono">
            <span className="text-base font-extrabold text-cyan-400">{speedKmH}</span>
            <span className="text-[10px] text-slate-500">км/ч</span>
            <span className="h-3 w-px bg-slate-700 mx-0.5" />
            <span className="text-xs font-bold text-amber-400">{gear}</span>
            <span className="h-3 w-px bg-slate-700 mx-0.5" />
            <span
              className={`text-xs font-bold ${
                condition > 60 ? 'text-emerald-400' : condition > 30 ? 'text-amber-400' : 'text-rose-500'
              }`}
            >
              {condition}%
            </span>
          </div>

          <button
            id="btn-enter-exit-vehicle"
            onClick={onToggleEnterExitVehicle}
            className="min-h-10 flex items-center gap-1 px-2.5 rounded-lg bg-amber-500 active:bg-amber-400 text-black font-bold shadow-lg transition-transform active:scale-95 cursor-pointer"
            aria-label={inVehicle ? 'Выйти из авто' : 'Сесть в авто'}
          >
            <Car className="w-4 h-4" />
            <span className="text-[10px] font-mono">{inVehicle ? 'Выйти' : 'Сесть'}</span>
          </button>

          <button
            id="btn-toggle-headlights"
            onClick={onToggleHeadlights}
            className={`min-h-10 min-w-10 flex items-center justify-center rounded-lg border cursor-pointer ${
              playerVehicle && playerVehicle.headlights > 0
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                : 'bg-slate-800/80 text-slate-300 border-slate-700'
            }`}
            aria-label="Фары"
            title="Фары"
          >
            <Lightbulb className="w-4 h-4" />
          </button>

          <button
            id="btn-turn-left"
            onClick={() => onToggleTurnSignal('left')}
            className={`min-h-10 min-w-10 flex items-center justify-center rounded-lg border font-bold cursor-pointer ${
              playerVehicle?.turnSignal === 'left'
                ? 'bg-amber-500 text-black border-amber-400 animate-pulse'
                : 'bg-slate-800/80 text-slate-300 border-slate-700'
            }`}
            aria-label="Левый поворотник"
          >
            ←
          </button>

          <button
            id="btn-turn-right"
            onClick={() => onToggleTurnSignal('right')}
            className={`min-h-10 min-w-10 flex items-center justify-center rounded-lg border font-bold cursor-pointer ${
              playerVehicle?.turnSignal === 'right'
                ? 'bg-amber-500 text-black border-amber-400 animate-pulse'
                : 'bg-slate-800/80 text-slate-300 border-slate-700'
            }`}
            aria-label="Правый поворотник"
          >
            →
          </button>

          <button
            id="btn-hazard-lights"
            onClick={() => onToggleTurnSignal('hazard')}
            className={`min-h-10 min-w-10 flex items-center justify-center rounded-lg border cursor-pointer ${
              playerVehicle?.turnSignal === 'hazard'
                ? 'bg-red-600 text-white border-red-400 animate-pulse'
                : 'bg-slate-800/80 text-slate-300 border-slate-700'
            }`}
            aria-label="Аварийка"
          >
            ⚠
          </button>

          <button
            id="btn-repair-car"
            onClick={onRepairVehicle}
            className="min-h-10 min-w-10 flex items-center justify-center rounded-lg bg-slate-800/80 text-cyan-300 border border-cyan-500/30 cursor-pointer"
            aria-label="Ремонт авто"
            title="Ремонт авто"
          >
            <Wrench className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. MIDDLE AREA (Active Mission HUD Overlay) */}
      {activeMission && (
        <div className="flex w-full">
          <div
            id="active-mission-hud-card"
            className="pointer-events-auto bg-slate-950/95 border-2 border-amber-500/80 rounded-xl p-2 shadow-2xl w-full sm:max-w-sm"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold text-[11px]">
                <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                <span>ТЕКУЩЕЕ ЗАДАНИЕ</span>
              </div>
              {activeMission.currentSeconds !== undefined && (
                <div className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  ⏱ {Math.floor(activeMission.currentSeconds / 60)}:
                  {String(Math.floor(activeMission.currentSeconds % 60)).padStart(2, '0')}
                </div>
              )}
            </div>

            <h4 className="text-xs font-bold text-slate-100 mb-0.5 truncate">{activeMission.titleRu}</h4>

            <div className="flex items-center justify-between pt-1 text-xs">
              <span className="text-emerald-400 font-mono font-bold">
                +{activeMission.rewardMoney.toLocaleString()} ₽
              </span>
              {targetPoi && (
                <span className="text-cyan-300 font-mono">
                  {distToTarget} м
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Radio feed: chat lines + join/leave, directly above the controls
          legend so it never overlaps it or the minimap regardless of screen size */}
      <div className="pointer-events-none w-full">
        <NetworkFeed events={feedEvents} />
      </div>

      {/* 3. BOTTOM ROW: Controls Legend (Left) + Driving Instrument Pod (Right)
          Desktop only - on touch this whole block (and the tall instrument
          pod that used to collide with the wheel/pedals) is replaced by the
          compact hud-touch-quickbar above, keeping the bottom strip clear
          for the on-screen driving controls. */}
      {!isTouchDevice && (
      <div
        id="hud-bottom-row"
        className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-2 w-full pointer-events-auto"
      >
        {/* Bottom-Left Controls Helper — collapsed to one line by default;
            the full key reference is a click away instead of a permanent
            block of space. */}
        <div
          id="hud-controls-legend"
          className="bg-slate-950/95 border border-slate-800/80 rounded-xl shadow-xl w-full sm:max-w-md text-[11px] font-mono text-slate-300"
        >
          <button
            id="btn-toggle-controls-legend"
            onClick={() => setShowControlsHelp((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer"
            aria-expanded={showControlsHelp}
          >
            <span className="flex items-center gap-1.5 min-w-0 text-left truncate">
              <span className="text-xs font-bold text-cyan-400 tracking-wider uppercase shrink-0">Управление</span>
              {!showControlsHelp && (
                <span className="text-slate-400 truncate">
                  <span className="text-amber-400 font-bold">WASD</span> ехать · <span className="text-amber-400 font-bold">[E]</span> сесть/выйти · <span className="text-amber-400 font-bold">[H]</span> гудок
                </span>
              )}
            </span>
            {showControlsHelp ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" /> : <ChevronUp className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
          </button>

          {showControlsHelp && (
            <div className="px-2.5 pb-2.5 max-h-40 sm:max-h-none overflow-y-auto sm:overflow-visible space-y-1 border-t border-slate-800 pt-2">
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
            </div>
          )}
        </div>

        {/* Bottom-Right Driving Actions + Instrument Pod */}
        <div className="flex flex-col items-stretch gap-1.5 w-full sm:w-80 max-w-full">
          <button
            id="btn-enter-exit-vehicle"
            onClick={onToggleEnterExitVehicle}
            className="w-full min-h-10 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl shadow-xl transition-transform active:scale-95 cursor-pointer"
          >
            <Car className="w-4 h-4" />
            <span className="font-mono text-xs">{inVehicle ? '[E] Выйти из авто' : '[E] Сесть в КАМАЗ / авто'}</span>
          </button>

          <div
            id="hud-instrument-pod"
            className="bg-slate-950/95 border-2 border-slate-700/80 rounded-xl sm:rounded-2xl p-2 sm:p-2.5 shadow-2xl w-full space-y-1.5 sm:space-y-2"
          >
          {/* Top Row: Speedometer + Gear + Vehicle Name */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-extrabold font-mono text-cyan-400 tracking-tight drop-shadow-[0_0_10px_#22d3ee]">
                {speedKmH}
              </span>
              <span className="text-xs font-mono text-slate-400 font-bold whitespace-nowrap">КМ/Ч</span>
            </div>

            <div className="text-right">
              <div className="max-w-40 text-xs sm:text-sm font-bold text-slate-100 truncate">
                {vehicleConfig ? vehicleConfig.nameRu : playerChar.name}
              </div>
              <div className="text-[11px] sm:text-xs font-mono text-amber-400">
                <span className="hidden sm:inline">Передача: </span><span className="font-bold text-cyan-300">{gear}</span>
              </div>
            </div>
          </div>

          {/* Condition / Durability Health Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 flex items-center gap-1">
                <Wrench className="w-3.5 h-3.5 text-emerald-400" />
                <span className="sm:hidden">Состояние</span><span className="hidden sm:inline">Состояние (Condition):</span>
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
            className="w-full flex items-center justify-center gap-1.5 text-xs font-mono font-bold py-1 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 transition-colors cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span className="sm:hidden">Ремонт [R]</span><span className="hidden sm:inline">Ремонт авто [R]</span>
          </button>

          {/* Headlights & Turn Signal Controls Bar (Screenshot Match) */}
          <div className="flex items-center justify-between gap-1 pt-0.5 sm:gap-1.5 sm:pt-1">
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
              className={`flex-[2] min-h-10 py-1 px-1 sm:px-2 rounded text-xs font-mono font-bold border transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                playerVehicle && playerVehicle.headlights > 0
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {playerVehicle?.headlights === 2
                  ? 'Дальний (L)'
                  : playerVehicle?.headlights === 1
                  ? 'Ближний (L)'
                  : 'Фары Выкл (L)'}
              </span>
              <span className="sm:hidden">L</span>
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
      )}
    </div>
  );
};
