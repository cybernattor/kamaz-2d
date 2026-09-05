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

const STEER_TRAVEL_PX = 46; // half-width of knob travel inside the wheel base

/**
 * Analog steering wheel. A single pointer drags the knob left/right inside
 * a circular base; horizontal offset maps linearly to -1..1. Unlike the old
 * left/right buttons this gives proportional steering instead of
 * full-lock-or-nothing, which is the whole point of a "wheel" control.
 *
 * Pointer Events (not touch+mouse handlers) are used deliberately: a single
 * event model means no risk of a delayed synthetic mouse event reactivating
 * steering after the finger has already lifted (the "ghost click" problem
 * touchstart/mousedown pairs have on WebKit), and pointer capture keeps the
 * drag tracking correctly even if the finger slides outside the wheel.
 */
const SteeringWheel: React.FC<{ onChange: (value: number | null) => void }> = ({ onChange }) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [knobX, setKnobX] = useState(0);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dx = Math.max(-STEER_TRAVEL_PX, Math.min(STEER_TRAVEL_PX, clientX - centerX));
      setKnobX(dx);
      onChange(dx / STEER_TRAVEL_PX);
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
    setKnobX(0);
    onChange(null);
  };

  return (
    <div className="flex flex-col items-center gap-1 pointer-events-auto">
      <div
        id="vwheel-base"
        ref={baseRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        style={{ touchAction: 'none' }}
        className="relative w-[116px] h-[116px] rounded-full bg-slate-900/85 border-2 border-slate-700 shadow-xl select-none"
        role="slider"
        aria-label="Руль"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number((knobX / STEER_TRAVEL_PX).toFixed(2))}
      >
        {/* Track hint */}
        <div className="absolute inset-3 rounded-full border border-slate-700/60" />
        <div
          id="vwheel-knob"
          className="absolute top-1/2 left-1/2 w-12 h-12 -mt-6 -ml-6 rounded-full bg-cyan-600/90 border-2 border-cyan-300 shadow-lg transition-transform"
          style={{ transform: `translateX(${knobX}px)`, transitionDuration: activePointerId.current ? '0ms' : '120ms' }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold text-slate-400 tracking-wider">РУЛЬ</span>
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

export const VirtualControls: React.FC<VirtualControlsProps> = ({ onInput, onSteerChange }) => {
  return (
    <div
      id="virtual-controls-container"
      className="fixed inset-x-0 bottom-2 pointer-events-none flex items-end justify-between px-3 z-40 select-none"
    >
      {/* Left: analog steering wheel */}
      <SteeringWheel onChange={onSteerChange} />

      {/* Right: horn + handbrake stacked small, gas/brake pedals stacked large */}
      <div className="flex items-end gap-2 pointer-events-auto">
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
      </div>
    </div>
  );
};
