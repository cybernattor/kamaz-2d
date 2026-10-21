import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Volume2, ParkingSquare, Car, Zap, Footprints } from 'lucide-react';

interface VirtualControlsProps {
  /** Discrete pedal/button inputs. Steering is handled separately via onSteerChange. */
  onInput: (action: 'throttle' | 'brake' | 'handbrake' | 'horn' | 'reverse', active: boolean) => void;
  /**
   * Continuous steering: -1 (full left) .. 1 (full right), 0 = centered
   * while held. `null` means the stick isn't being touched at all, which
   * hands steering back to the keyboard (A/D) instead of forcing it to 0 -
   * otherwise letting go would fight a keyboard press on hybrid
   * touch+keyboard devices.
   */
  onSteerChange: (value: number | null) => void;
  /** On-foot movement: x/y in -1..1 (screen axes), null when released. */
  onMoveChange: (value: { x: number; y: number } | null) => void;
  keyboardSteer: number;
  /** Touch device: floating steering zone + pedals. Desktop gets just the wheel. */
  showPedals: boolean;
  inVehicle: boolean;
  onToggleEnterExit: () => void;
  /** Layout settings panel; opened from the HUD menu. */
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
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
/** Finger travel (px) from the touch-down point that equals full lock. */
const STICK_RADIUS = 64;
const STICK_DEAD_ZONE = 0.08;
const STICK_CURVE = 1.4;
const WHEEL_SIZE = 96;
const MOVE_DEAD_ZONE = 0.15;

/** Radial dead zone for the on-foot stick; magnitude rescaled to 0..1. */
export function shapeMove(rawX: number, rawY: number): { x: number; y: number } {
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude < MOVE_DEAD_ZONE) return { x: 0, y: 0 };
  const scaled = Math.min(1, (magnitude - MOVE_DEAD_ZONE) / (1 - MOVE_DEAD_ZONE));
  return { x: (rawX / magnitude) * scaled, y: (rawY / magnitude) * scaled };
}

/** Phone ≈ 1; tablets (Redmi Pad Pro ≈ 800 CSS px short side) scale up so the
 * stick, wheel and pedals keep a comfortable physical size under a thumb. */
function computeUiScale() {
  if (typeof window === 'undefined') return 1;
  return Math.max(1, Math.min(1.7, Math.min(window.innerWidth, window.innerHeight) / 400));
}

/** Portrait phones: the pedal cluster would otherwise overlap the wheel. */
function computeNarrowFit() {
  if (typeof window === 'undefined' || window.innerWidth >= 520) return 1;
  return Math.max(0.8, Math.min(1, (window.innerWidth - 150) / 250));
}

function useUiScale() {
  const [scale, setScale] = useState(() => ({ ui: computeUiScale(), fit: computeNarrowFit() }));
  useEffect(() => {
    const update = () => setScale({ ui: computeUiScale(), fit: computeNarrowFit() });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return scale;
}

const LAYOUT_KEY = 'kamaz.touchLayout';
const HINT_KEY = 'kamaz.touchHintSeen.v4';

interface TouchLayout {
  lefty: boolean;
  scale: number;
}

const DEFAULT_LAYOUT: TouchLayout = { lefty: false, scale: 1 };
const SCALES = [0.85, 1, 1.15];

function loadLayout(): TouchLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    return {
      lefty: parsed?.lefty === true,
      scale: SCALES.includes(parsed?.scale) ? parsed.scale : 1,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: TouchLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage can be blocked (private mode); the layout just won't persist.
  }
}

/** Dead zone + soft curve: precise near center, full lock at the edge. */
export function shapeSteer(raw: number): number {
  const clamped = Math.max(-1, Math.min(1, raw));
  const magnitude = Math.abs(clamped);
  if (magnitude < STICK_DEAD_ZONE) return 0;
  const rescaled = (magnitude - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
  return Math.sign(clamped) * Math.pow(rescaled, STICK_CURVE);
}

/**
 * Floating steering stick with a wheel as its visual. On touch the whole
 * lower side of the screen is the hit area: the first touch sets the
 * neutral point and the wheel appears under the thumb, so there is no
 * "missing the wheel" and no jump to full lock on touch-down. Steering is the
 * finger's horizontal travel from that point. On desktop it is a fixed wheel
 * with the same relative maths.
 *
 * Pointer Events (not touch+mouse handlers) are used deliberately: a single
 * event model means no delayed synthetic mouse event reactivating steering
 * after the finger lifted, and pointer capture keeps tracking when the
 * finger leaves the zone.
 */
const SteeringStick: React.FC<{
  onChange: (value: number | null) => void;
  /** On foot the same zone becomes a free 2D move stick (x/y in -1..1). */
  mode: 'steer' | 'move';
  onMove: (value: { x: number; y: number } | null) => void;
  keyboardSteer: number;
  floating: boolean;
  lefty: boolean;
  uiScale: number;
}> = ({ onChange, mode, onMove, keyboardSteer, floating, lefty, uiScale }) => {
  const size = WHEEL_SIZE * uiScale;
  const radius = STICK_RADIUS * uiScale;
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const originClientX = useRef(0);
  const originClientY = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [moveVec, setMoveVec] = useState<{ x: number; y: number } | null>(null);
  const [pointerSteer, setPointerSteer] = useState<number | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  const updateFromClient = useCallback(
    (clientX: number, clientY: number) => {
      // The neutral point trails the finger once it passes full lock: the
      // thumb never has to travel further than `radius`, and coming back
      // toward center steers back immediately instead of after retracing.
      let dx = clientX - originClientX.current;
      let dy = clientY - originClientY.current;
      if (mode === 'move') {
        const dist = Math.hypot(dx, dy);
        if (dist > radius) {
          const k = (dist - radius) / dist;
          originClientX.current += dx * k;
          originClientY.current += dy * k;
          dx -= dx * k;
          dy -= dy * k;
        }
        const vec = shapeMove(dx / radius, dy / radius);
        setMoveVec(vec);
        onMoveRef.current(vec);
        return;
      }
      if (Math.abs(dx) > radius) {
        const overshoot = dx - Math.sign(dx) * radius;
        originClientX.current += overshoot;
        dx -= overshoot;
      }
      const value = shapeSteer(dx / radius);
      setPointerSteer(value);
      onChangeRef.current(value);
    },
    [mode, radius]
  );

  const release = useCallback(() => {
    if (activePointerId.current === null) return;
    activePointerId.current = null;
    setPointerSteer(null);
    setMoveVec(null);
    setOrigin(null);
    if (mode === 'move') onMoveRef.current(null);
    else onChangeRef.current(null);
  }, [mode]);

  // Never leave steering latched if the controls unmount mid-drag.
  useEffect(() => release, [release]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== null) return;
    e.preventDefault();
    const zone = zoneRef.current;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(8);

    if (floating) {
      const half = size / 2 + 4;
      const x = Math.max(half, Math.min(rect.width - half, e.clientX - rect.left));
      const y = Math.max(half, Math.min(rect.height - half, e.clientY - rect.top));
      originClientX.current = rect.left + x;
      originClientY.current = rect.top + y;
      setOrigin({ x, y });
    } else {
      originClientX.current = rect.left + rect.width / 2;
      originClientY.current = rect.top + rect.height / 2;
    }
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    e.preventDefault();
    updateFromClient(e.clientX, e.clientY);
  };

  const handleEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    release();
  };

  const displayedSteer = pointerSteer ?? keyboardSteer;
  const active = pointerSteer !== null || moveVec !== null;

  const inset = lefty ? 'right' : 'left';
  const restPosition: React.CSSProperties = {
    bottom: 'calc(max(env(safe-area-inset-bottom), 1.25rem) + 1rem)',
    [inset]: 'max(env(safe-area-inset-' + inset + '), 1.75rem)',
  };
  const wheelPosition: React.CSSProperties = origin
    ? { left: origin.x, top: origin.y, transform: 'translate(-50%, -50%)' }
    : restPosition;

  const wheel = mode === 'move' ? (
    <div
      id="vmove-base"
      className={`pointer-events-none absolute rounded-full border bg-slate-950/60 transition-colors ${
        active ? 'border-cyan-400/80' : 'border-slate-600/70'
      }`}
      style={{ width: size, height: size, ...(floating ? wheelPosition : { left: 0, top: 0 }) }}
    >
      <div
        className="absolute left-1/2 top-1/2 rounded-full border border-cyan-300/70 bg-cyan-900/60"
        style={{
          width: size * 0.42,
          height: size * 0.42,
          transform: `translate(calc(-50% + ${(moveVec?.x ?? 0) * (size / 2 - 8)}px), calc(-50% + ${(moveVec?.y ?? 0) * (size / 2 - 8)}px))`,
        }}
      />
    </div>
  ) : (
    <div
      id="vwheel-base"
      className={`pointer-events-none absolute rounded-full border bg-slate-950/70 shadow-[0_8px_20px_rgba(2,6,23,0.45),inset_0_0_0_1px_rgba(255,255,255,0.05)] transition-colors ${
        active ? 'border-cyan-400/80' : 'border-slate-600/70'
      }`}
      style={{ width: size, height: size, ...(floating ? wheelPosition : { left: 0, top: 0 }) }}
    >
      {/* Linear gauge: shows exactly how far the thumb is from neutral */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-slate-700/80 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
        style={{ top: -18, width: radius * 2, height: 6 }}
      >
        <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-slate-400/70" />
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border ${
            active ? 'border-cyan-200 bg-cyan-400' : 'border-slate-400 bg-slate-500'
          }`}
          style={{ left: `calc(50% + ${displayedSteer * radius}px)`, transform: 'translate(-50%, -50%)' }}
        />
      </div>
      <div className="absolute inset-[5px] rounded-full border border-slate-700/70 bg-[radial-gradient(circle_at_50%_42%,rgba(51,65,85,0.45),rgba(2,6,23,0.8)_70%)]" />
      <svg aria-hidden="true" viewBox="0 0 112 112" className="absolute inset-0 h-full w-full">
        <circle cx="56" cy="56" r="52" fill="none" stroke="rgba(34,211,238,.18)" strokeWidth="1" />
        <circle cx="56" cy="56" r="47" fill="none" stroke="rgba(148,163,184,.22)" strokeWidth="1" strokeDasharray="1 5" />
        <path d="M56 5v5" stroke="#67e8f9" strokeWidth="2" strokeLinecap="round" />
        <g
          id="vwheel-wheel"
          className={active ? 'transition-none' : 'transition-transform duration-200 ease-out'}
          style={{ transform: `rotate(${displayedSteer * STEER_MAX_ROTATION}deg)`, transformOrigin: '56px 56px' }}
        >
          <circle cx="56" cy="56" r="39" fill="none" stroke="#0b1220" strokeWidth="13" />
          <circle cx="56" cy="56" r="39" fill="none" stroke="#64748b" strokeWidth="8" />
          <circle cx="56" cy="56" r="35" fill="none" stroke="#94a3b8" strokeOpacity=".48" strokeWidth="1" />
          <path d="M56 53 35 31M56 53l21-22M56 53v31" fill="none" stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />
          <path d="M56 53 35 31M56 53l21-22M56 53v31" fill="none" stroke="#cbd5e1" strokeOpacity=".35" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="56" cy="53" r="12" fill="#0b1220" stroke="#94a3b8" strokeWidth="2" />
          <circle cx="56" cy="53" r="5" fill="#164e63" stroke="#67e8f9" strokeWidth="1.5" />
          <circle cx="56" cy="16" r="2" fill="#67e8f9" />
        </g>
      </svg>
    </div>
  );

  return (
    <div
      id="vwheel-zone"
      ref={zoneRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleEnd}
      onPointerCancel={handleEnd}
      onLostPointerCapture={handleEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={floating ? { touchAction: 'none' } : { touchAction: 'none', width: size, height: size }}
      className={
        floating
          ? `pointer-events-auto absolute bottom-0 h-1/2 w-[42%] ${lefty ? 'right-0' : 'left-0'}`
          : 'pointer-events-auto relative select-none'
      }
      role="slider"
      aria-label={mode === 'move' ? 'Движение' : 'Руль'}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(displayedSteer.toFixed(2))}
      aria-valuetext={`${Math.round(Math.abs(displayedSteer) * 100)}% ${displayedSteer < 0 ? 'влево' : displayedSteer > 0 ? 'вправо' : 'по центру'}`}
    >
      {wheel}
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
 * synthetic mouse event follows a touch event ~300ms after release.
 * Lost capture and unmount also release the input, so a pedal can't stay
 * latched when the layout changes under a finger. */
const PedalButton: React.FC<PedalButtonProps> = ({ id, label, className, icon, onActiveChange, haptic }) => {
  const pointerId = useRef<number | null>(null);
  const [pressed, setPressed] = useState(false);
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  useEffect(
    () => () => {
      if (pointerId.current !== null) {
        pointerId.current = null;
        onActiveChangeRef.current(false);
      }
    },
    []
  );

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== null) return;
    e.preventDefault();
    pointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(haptic);
    setPressed(true);
    onActiveChange(true);
  };
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    setPressed(false);
    onActiveChange(false);
  };

  return (
    <button
      id={id}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={`pointer-events-auto touch-none select-none [-webkit-touch-callout:none] ${className} ${
        pressed ? 'brightness-150 ring-2 ring-white/70' : ''
      }`}
      draggable={false}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
};

const SMALL_BTN =
  'h-12 w-12 rounded-full border text-white flex items-center justify-center shadow-xl select-none';

export const VirtualControls: React.FC<VirtualControlsProps> = ({
  onInput,
  onSteerChange,
  onMoveChange,
  keyboardSteer,
  showPedals,
  inVehicle,
  onToggleEnterExit,
  settingsOpen,
  onSettingsOpenChange,
}) => {
  const { ui: uiScale, fit: narrowFit } = useUiScale();
  const [layout, setLayout] = useState<TouchLayout>(loadLayout);
  const [cruise, setCruise] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [showHint, setShowHint] = useState(() => {
    if (!showPedals) return false;
    try {
      return localStorage.getItem(HINT_KEY) !== '1';
    } catch {
      return true;
    }
  });

  // The gas pedal drives forward, or backward while R is latched. AUTO
  // (cruise) only holds forward throttle, and brake interrupts only the
  // cruise part, so a manual gas+brake combo still works.
  const throttle = useRef({ gas: false, brake: false, cruise: false, reverse: false, sentThrottle: false, sentReverse: false });
  const syncThrottle = () => {
    const t = throttle.current;
    const forward = !t.reverse && (t.gas || (t.cruise && !t.brake));
    const backward = t.reverse && t.gas;
    if (forward !== t.sentThrottle) {
      t.sentThrottle = forward;
      onInput('throttle', forward);
    }
    if (backward !== t.sentReverse) {
      t.sentReverse = backward;
      onInput('reverse', backward);
    }
  };

  const dismissHint = () => {
    if (!showHint) return;
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Hint will simply show again next session.
    }
  };

  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(dismissHint, 9000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHint]);

  // Leaving the vehicle (or unmounting) must not leave cruise driving a pedestrian.
  useEffect(() => {
    if (!inVehicle && (throttle.current.cruise || throttle.current.reverse)) {
      throttle.current.cruise = false;
      throttle.current.reverse = false;
      setCruise(false);
      setReverse(false);
      syncThrottle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inVehicle]);

  useEffect(
    () => () => {
      throttle.current.cruise = false;
      throttle.current.reverse = false;
      throttle.current.gas = false;
      throttle.current.brake = false;
      syncThrottle();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const updateLayout = (patch: Partial<TouchLayout>) => {
    const next = { ...layout, ...patch };
    setLayout(next);
    saveLayout(next);
  };

  const toggleCruise = () => {
    hapticTick(15);
    dismissHint();
    throttle.current.cruise = !throttle.current.cruise;
    if (throttle.current.cruise) {
      // Cruise is forward-only.
      throttle.current.reverse = false;
      setReverse(false);
    }
    setCruise(throttle.current.cruise);
    syncThrottle();
  };

  const toggleReverse = () => {
    hapticTick(15);
    dismissHint();
    throttle.current.reverse = !throttle.current.reverse;
    if (throttle.current.reverse) {
      throttle.current.cruise = false;
      setCruise(false);
    }
    setReverse(throttle.current.reverse);
    syncThrottle();
  };

  const side = layout.lefty ? 'flex-row-reverse' : 'flex-row';
  const origin = layout.lefty ? 'bottom left' : 'bottom right';

  return (
    <div
      id="virtual-controls-container"
      className="pointer-events-none fixed inset-0 z-40 select-none"
      onPointerDownCapture={dismissHint}
    >
      {/* Touch: the stick's hit area is the lower half of the screen side, so
          it lives outside the bottom bar that only wraps the pedals. */}
      {showPedals && (
        <SteeringStick
          key={inVehicle ? 'steer' : 'move'}
          mode={inVehicle ? 'steer' : 'move'}
          onMove={onMoveChange}
          onChange={onSteerChange}
          keyboardSteer={keyboardSteer}
          floating
          lefty={layout.lefty}
          uiScale={uiScale}
        />
      )}
      <div
        className={`absolute inset-x-0 bottom-0 flex items-end ${showPedals ? 'justify-end' : 'justify-start'} ${side}`}
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 1.25rem)',
          paddingLeft: 'max(env(safe-area-inset-left), 1.75rem)',
          paddingRight: 'max(env(safe-area-inset-right), 1.75rem)',
        }}
      >
        {!showPedals && inVehicle && (
          <SteeringStick
            mode="steer"
            onMove={onMoveChange}
            onChange={onSteerChange}
            keyboardSteer={keyboardSteer}
            floating={false}
            lefty={false}
            uiScale={1}
          />
        )}

        {showPedals && (
          <div
            className="pointer-events-none flex flex-col items-end gap-2"
            style={{ transform: `scale(${layout.scale * uiScale * narrowFit})`, transformOrigin: origin }}
          >
            {settingsOpen && (
              <div
                id="vctrl-settings"
                className="pointer-events-auto w-56 space-y-2 rounded-xl border border-slate-600 bg-slate-950/95 p-2.5 text-xs text-slate-200 shadow-2xl"
              >
                <button
                  id="vctrl-lefty"
                  onClick={() => updateLayout({ lefty: !layout.lefty })}
                  className="flex min-h-11 w-full items-center justify-between rounded-lg bg-slate-800 px-3"
                >
                  <span>Режим левши</span>
                  <span className={layout.lefty ? 'font-bold text-emerald-400' : 'text-slate-400'}>
                    {layout.lefty ? 'вкл' : 'выкл'}
                  </span>
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 pr-1 text-slate-400">Размер</span>
                  {SCALES.map((s) => (
                    <button
                      key={s}
                      onClick={() => updateLayout({ scale: s })}
                      className={`min-h-11 flex-1 rounded-lg font-mono ${
                        layout.scale === s ? 'bg-cyan-600 font-bold text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {s === 0.85 ? 'S' : s === 1 ? 'M' : 'L'}
                    </button>
                  ))}
                </div>
                <button
                  id="vctrl-settings-done"
                  onClick={() => onSettingsOpenChange(false)}
                  className="min-h-11 w-full rounded-lg bg-cyan-700 font-bold text-white"
                >
                  Готово
                </button>
              </div>
            )}

            {/* Utility row */}
            <div className={`flex items-center gap-2 ${side}`}>
              <button
                id="btn-enter-exit-vehicle"
                onClick={onToggleEnterExit}
                className="pointer-events-auto flex h-12 min-w-12 items-center justify-center gap-1 rounded-full bg-amber-500/90 px-3 text-black shadow-xl active:bg-amber-400"
                aria-label={inVehicle ? 'Выйти из авто' : 'Сесть в авто'}
              >
                <Car className="h-5 w-5" />
                <span className="font-mono text-[11px] font-bold">{inVehicle ? 'Выйти' : 'Сесть'}</span>
              </button>
              {inVehicle && <button
                id="vbtn-cruise"
                onClick={toggleCruise}
                className={`pointer-events-auto ${SMALL_BTN} flex-col text-[10px] font-bold font-mono leading-none ${
                  cruise ? 'border-emerald-300 bg-emerald-600' : 'border-slate-500 bg-slate-800/60'
                }`}
                aria-pressed={cruise}
                aria-label="Автогаз"
              >
                <Zap className="h-4 w-4" />
                AUTO
              </button>}
              {inVehicle && (
                <>
              <PedalButton
                id="vbtn-horn"
                label="Подать сигнал"
                haptic={5}
                onActiveChange={(active) => onInput('horn', active)}
                className={`${SMALL_BTN} border-amber-500 bg-amber-600/60 active:bg-amber-500`}
                icon={<Volume2 className="h-5 w-5" />}
              />
              <PedalButton
                id="vbtn-handbrake"
                label="Ручник / Дрифт"
                haptic={15}
                onActiveChange={(active) => onInput('handbrake', active)}
                className={`${SMALL_BTN} border-slate-500 bg-slate-800/60 active:bg-rose-600`}
                icon={<ParkingSquare className="h-5 w-5" />}
              />
                </>
              )}
            </div>

            {/* On foot: one big sprint button replaces the pedals */}
            {!inVehicle && (
              <PedalButton
                id="vbtn-sprint"
                label="Бег"
                haptic={10}
                onActiveChange={(active) => onInput('handbrake', active)}
                className="flex h-24 w-24 flex-col items-center justify-center rounded-2xl border border-cyan-500 bg-cyan-700/60 font-mono text-sm font-bold text-white shadow-xl active:bg-cyan-500"
                icon={
                  <>
                    <Footprints className="h-7 w-7" />
                    <span>БЕГ</span>
                  </>
                }
              />
            )}

            {/* Pedals: brake next to gas so one thumb slides between them */}
            {inVehicle && <div className={`flex items-end gap-2 ${side}`}>
              <button
                id="vbtn-reverse"
                onClick={toggleReverse}
                className={`pointer-events-auto flex h-14 w-14 items-center justify-center rounded-2xl border font-mono text-xl font-bold text-white shadow-xl select-none ${
                  reverse ? 'border-amber-300 bg-amber-600 ring-2 ring-amber-300/60' : 'border-slate-500 bg-slate-800/60'
                }`}
                aria-pressed={reverse}
                aria-label="Задний ход"
              >
                R
              </button>
              <PedalButton
                id="vbtn-brake"
                label="Тормоз"
                haptic={12}
                onActiveChange={(active) => {
                  throttle.current.brake = active;
                  onInput('brake', active);
                  syncThrottle();
                }}
                className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-0.5 rounded-2xl border border-rose-600 bg-rose-700/60 font-mono text-[11px] font-bold leading-tight text-white shadow-xl active:bg-rose-600"
                icon={
                  <>
                    <ArrowDown className="h-5 w-5" />
                    <span>СТОП</span>
                  </>
                }
              />
              <PedalButton
                id="vbtn-gas"
                label="Газ"
                haptic={12}
                onActiveChange={(active) => {
                  throttle.current.gas = active;
                  syncThrottle();
                }}
                className={`flex h-24 w-24 flex-col items-center justify-center rounded-2xl border font-mono text-sm font-bold text-white shadow-xl ${
                  reverse
                    ? 'border-amber-400 bg-amber-600/60 active:bg-amber-500'
                    : 'border-emerald-500 bg-emerald-600/60 active:bg-emerald-500'
                }`}
                icon={
                  <>
                    {reverse ? <ArrowDown className="h-7 w-7" /> : <ArrowUp className="h-7 w-7" />}
                    <span>{reverse ? 'НАЗАД' : 'ГАЗ'}</span>
                  </>
                }
              />
            </div>}
          </div>
        )}
      </div>

      {showHint && (
        <div
          id="vctrl-hint"
          className="pointer-events-none absolute left-1/2 top-1/3 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-cyan-500/50 bg-slate-950/90 p-3 text-center text-xs leading-relaxed text-slate-200 shadow-2xl"
        >
          <b className="text-cyan-300">Слева</b> — коснитесь и ведите палец вбок: руль (пешком — джойстик в любую сторону). <b className="text-emerald-300">Справа</b> — газ.
          <br />
          <b className="text-amber-300">R</b> — задний ход (газ едет назад), нажмите ещё раз, чтобы вернуть вперёд. <b className="text-emerald-300">AUTO</b> — газ включён сам.
          <br />
          Сверху: поворотники, аварийка, фары и платный ремонт (цена по повреждениям). Звук, зум и настройки управления — в меню <b className="text-cyan-300">≡</b>.
        </div>
      )}
    </div>
  );
};
