import React, { useCallback, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Volume2, ParkingSquare } from 'lucide-react';

interface VirtualControlsProps {
  /** Discrete pedal/button inputs. Steering is handled separately via onSteerChange. */
  onInput: (action: 'throttle' | 'brake' | 'handbrake' | 'horn', active: boolean) => void;
  /**
   * Continuous steering: -1 (full left) .. 1 (full right), 0 = centered
   * while held. `null` means the wheel isn't being touched at all, which
   * hands steering back to the keyboard (A/D) instead of forcing it to 0 -
   * otherwise letting go of the wheel would fight a keyboard press on
   * hybrid touch+keyboard devices.
   */
  onSteerChange: (value: number | null) => void;
  keyboardSteer: number;
  showPedals: boolean;
}

/** Short tap of the device vibrator, if available. Silently no-ops on
 * desktop browsers / devices without a vibration motor. */
function hapticTick(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Vibration API can throw on some locked-down embedded webviews.
  }
}

const STEER_MAX_ROTATION = 120;

/**
 * Analog steering wheel. A single pointer drags horizontally across the
 * wheel; the wheel itself rotates proportionally to -1..1. The external
 * keyboard value keeps the visual state in sync with A/D and arrow keys.
 *
 * Pointer Events (not touch+mouse handlers) are used deliberately: a single
 * event model means no risk of a delayed synthetic mouse event reactivating
 * steering after the finger has already lifted (the "ghost click" problem
 * touchstart/mousedown pairs have on WebKit), and pointer capture keeps the
 * drag tracking correctly even if the finger slides outside the wheel.
 */
const SteeringWheel: React.FC<{
  onChange: (value: number | null) => void;
  keyboardSteer: number;
}> = ({ onChange, keyboardSteer }) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [pointerSteer, setPointerSteer] = useState<number | null>(null);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const normalized = Math.max(-1, Math.min(1, (clientX - centerX) / (rect.width / 2)));
      setPointerSteer(normalized);
      onChange(normalized);
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(8);
    updateFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    e.preventDefault();
    updateFromClientX(e.clientX);
  };

  const releasePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    setPointerSteer(null);
    onChange(null);
  };

  const displayedSteer = pointerSteer ?? keyboardSteer;

  return (
    <div className="flex flex-col items-center gap-1.5 pointer-events-auto">
      <div
        id="vwheel-base"
        ref={baseRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        style={{ touchAction: 'none' }}
        className="relative w-32 h-32 rounded-full bg-slate-950/95 border border-slate-700/80 shadow-[0_12px_28px_rgba(2,6,23,0.5),inset_0_0_0_2px_rgba(255,255,255,0.04)] select-none"
        role="slider"
        aria-label="Руль"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number(displayedSteer.toFixed(2))}
        aria-valuetext={`${Math.round(Math.abs(displayedSteer) * 100)}% ${displayedSteer < 0 ? 'влево' : displayedSteer > 0 ? 'вправо' : 'по центру'}`}
      >
        {/* Fixed dashboard bezel and steering-strength ticks. */}
        <div className="absolute inset-1 rounded-full border-2 border-slate-800 bg-slate-900/70" />
        <div className="absolute inset-0 rounded-full border border-cyan-400/15" />
        <div className="absolute left-1/2 top-0 h-1 w-8 -translate-x-1/2 rounded-b-full bg-cyan-300/80 shadow-[0_0_10px_rgba(103,232,249,0.45)]" />
        <div className="absolute left-2 top-1/2 h-px w-2 -translate-y-1/2 bg-cyan-300/40" />
        <div className="absolute right-2 top-1/2 h-px w-2 -translate-y-1/2 bg-cyan-300/40" />

        {/* Rotating leather rim, spokes and hub. */}
        <div
          id="vwheel-wheel"
          className={`absolute inset-2 rounded-full border-[9px] border-slate-700 bg-slate-900 shadow-[inset_0_0_0_2px_rgba(15,23,42,0.95),inset_0_0_12px_rgba(2,6,23,0.9)] ${pointerSteer === null ? 'transition-transform duration-200 ease-out' : 'transition-none'}`}
          style={{ transform: `rotate(${displayedSteer * STEER_MAX_ROTATION}deg)` }}
        >
          <div className="absolute inset-1 rounded-full border border-slate-500/40" />
          <div className="absolute left-1/2 top-1/2 h-[47%] w-2.5 -translate-x-1/2 -translate-y-full rounded-full bg-slate-500 shadow-[inset_1px_0_0_rgba(255,255,255,0.22)]" />
          <div className="absolute left-1/2 top-1/2 h-2.5 w-[47%] origin-left -translate-y-1/2 rotate-[150deg] rounded-full bg-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]" />
          <div className="absolute left-1/2 top-1/2 h-2.5 w-[47%] origin-left -translate-y-1/2 -rotate-[150deg] rounded-full bg-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]" />
          <div className="absolute left-1/2 top-[7px] h-2 w-2 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.55)]" />
          <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-slate-500 bg-slate-950 shadow-[0_2px_6px_rgba(2,6,23,0.8),inset_0_0_0_2px_rgba(255,255,255,0.08)]">
            <div className="h-5 w-5 rounded-full border border-cyan-300/80 bg-slate-800 shadow-[0_0_0_3px_rgba(8,145,178,0.18)]" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold tracking-[0.18em] text-slate-300">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(103,232,249,0.7)]" />
        <span>РУЛЬ</span>
      </div>
    </div>
  );
};

interface PedalButtonProps {
  id: string;
  label: string;
  className: string;
  icon: React.ReactNode;
  onActiveChange: (active: boolean) => void;
  haptic?: number;
}

/** A single-pointer, single-event-model button. Using pointerdown/up/cancel
 * (instead of separate touch and mouse handlers) avoids double-firing and
 * the delayed "ghost" reactivation some mobile browsers produce when a
 * synthetic mouse event follows a touch event ~300ms after release. */
const PedalButton: React.FC<PedalButtonProps> = ({ id, label, className, icon, onActiveChange, haptic }) => {
  const pointerId = useRef<number | null>(null);

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    pointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(haptic);
    onActiveChange(true);
  };
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    onActiveChange(false);
  };

  return (
    <button
      id={id}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={className}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
};

export const VirtualControls: React.FC<VirtualControlsProps> = ({ onInput, onSteerChange, keyboardSteer, showPedals }) => {
  return (
    <div
      id="virtual-controls-container"
      className="fixed inset-x-0 bottom-2 pointer-events-none flex items-end justify-between px-3 z-40 select-none"
    >
      {/* Left: analog steering wheel */}
      <SteeringWheel onChange={onSteerChange} keyboardSteer={keyboardSteer} />

      {/* Right: horn + handbrake stacked small, gas/brake pedals stacked large */}
      {showPedals && <div className="flex items-end gap-2 pointer-events-auto">
        <div className="flex flex-col gap-2">
          <PedalButton
            id="vbtn-horn"
            label="Подать сигнал"
            haptic={5}
            onActiveChange={(active) => onInput('horn', active)}
            className="w-11 h-11 rounded-full bg-amber-600/80 border border-amber-500 text-white flex items-center justify-center active:bg-amber-500 shadow-xl"
            icon={<Volume2 className="w-5 h-5" />}
          />
          <PedalButton
            id="vbtn-handbrake"
            label="Ручник / Дрифт"
            haptic={15}
            onActiveChange={(active) => onInput('handbrake', active)}
            className="w-11 h-11 rounded-full bg-slate-800/85 border border-slate-500 text-white flex items-center justify-center active:bg-rose-600 shadow-xl"
            icon={<ParkingSquare className="w-5 h-5" />}
          />
        </div>

        <div className="flex flex-col gap-2 items-center">
          <PedalButton
            id="vbtn-brake"
            label="Тормоз"
            haptic={12}
            onActiveChange={(active) => onInput('brake', active)}
            className="w-16 h-16 rounded-2xl bg-rose-700/85 border border-rose-600 text-white flex flex-col items-center justify-center gap-0.5 active:bg-rose-600 shadow-xl font-mono text-[9px] font-bold leading-tight"
            icon={
              <>
                <ArrowDown className="w-5 h-5" />
                <span>ТОРМОЗ</span>
                <span className="text-[7px] text-rose-200 font-normal">SPACE</span>
              </>
            }
          />
          <PedalButton
            id="vbtn-gas"
            label="Газ"
            haptic={12}
            onActiveChange={(active) => onInput('throttle', active)}
            className="w-20 h-20 rounded-2xl bg-emerald-600/85 border border-emerald-500 text-white flex flex-col items-center justify-center active:bg-emerald-500 shadow-xl font-mono text-xs font-bold"
            icon={
              <>
                <ArrowUp className="w-6 h-6" />
                <span>ГАЗ</span>
              </>
            }
          />
        </div>
      </div>}
    </div>
  );
};
