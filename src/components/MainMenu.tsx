import React, { useEffect, useState } from 'react';
import { Truck, Users, Wrench, Briefcase, Moon, Volume2, VolumeX, Loader2, Settings, RotateCw } from 'lucide-react';

interface MainMenuProps {
  isTouchDevice: boolean;
  isMuted: boolean;
  volume: number;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onPlay: () => void;
}

const TIPS_DESKTOP = [
  '[W] — газ, [S] — назад, [Space] — тормоз, [Shift] — ручник',
  'WASD — управление, [E] — сесть в машину или выйти из неё',
  'Берите задания [J] и зарабатывайте деньги на новые машины',
  'В гараже [G] можно сменить машину и её цвет',
  '[T] — переключить день/ночь, [L] — фары, [H] — гудок',
  'В скорой и полиции [J] включает сирену вместо заданий',
];

const TIPS_TOUCH = [
  'Круг слева — руль, педали справа — газ и тормоз',
  'Педаль тормоза после остановки, если её не отпускать, включает задний ход',
  'Кнопка с флажком — ручник и дрифт, рядом — сигнал',
  'Кнопка в HUD со значком машины — сесть или выйти из неё',
  'Берите задания через кнопку в HUD и зарабатывайте деньги',
  'В гараже можно сменить машину и её цвет',
];

/**
 * Silent bot-check: no puzzle for the player to solve. The Play button stays
 * disabled until we've seen a real pointer/touch/key event and a short delay
 * has passed — a scripted client that clicks Play immediately on load, or
 * never dispatches input events at all, never gets past this. `navigator.
 * webdriver` catches the common automation case outright.
 */
function useHumanCheck() {
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      setBlocked(true);
      return;
    }

    let sawInteraction = false;
    let delayElapsed = false;

    const tryReady = () => {
      if (sawInteraction && delayElapsed) setReady(true);
    };

    const onInteraction = () => {
      sawInteraction = true;
      tryReady();
    };

    window.addEventListener('pointermove', onInteraction, { once: true });
    window.addEventListener('pointerdown', onInteraction, { once: true });
    window.addEventListener('touchstart', onInteraction, { once: true });
    window.addEventListener('keydown', onInteraction, { once: true });

    const timer = setTimeout(() => {
      delayElapsed = true;
      tryReady();
    }, 700);

    return () => {
      window.removeEventListener('pointermove', onInteraction);
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('touchstart', onInteraction);
      window.removeEventListener('keydown', onInteraction);
      clearTimeout(timer);
    };
  }, []);

  return { ready, blocked };
}

/**
 * The whole touch control scheme (wheel bottom-left, pedals bottom-right)
 * is laid out for a wide, short viewport. Nothing elsewhere in the app
 * checks orientation, so a player who opens the game in portrait (a
 * phone's default) gets a cramped view with no warning until they're
 * already driving. Surface it here instead, before Play is even pressed.
 */
function useIsPortrait() {
  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches
  );

  useEffect(() => {
    const query = window.matchMedia('(orientation: portrait)');
    const update = () => setIsPortrait(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isPortrait;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  isTouchDevice,
  isMuted,
  volume,
  onToggleMute,
  onVolumeChange,
  onPlay,
}) => {
  const { ready, blocked } = useHumanCheck();
  const isPortrait = useIsPortrait();
  const tips = isTouchDevice ? TIPS_TOUCH : TIPS_DESKTOP;
  const [tipIndex, setTipIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 4000);
    return () => clearInterval(id);
  }, [tips.length]);

  return (
    <div
      id="main-menu-overlay"
      className="absolute inset-0 z-[150] flex items-center justify-center bg-slate-950/97 backdrop-blur-sm p-4 select-none"
    >
      <div className="w-full max-w-md flex flex-col items-center text-center gap-5">
        {/* Orientation nudge: the wheel/pedals layout needs a wide, short
            viewport. A firm suggestion beats letting the player discover a
            cramped control layout mid-drive. Not a hard gate — some tablets
            are perfectly playable in portrait. */}
        {isTouchDevice && isPortrait && (
          <div className="w-full flex items-center gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-500/40 rounded-lg px-3 py-2">
            <RotateCw className="w-4 h-4 shrink-0 animate-pulse" />
            <span>Поверните телефон горизонтально — руль и педали рассчитаны на альбомную ориентацию</span>
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col items-center gap-2">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-2xl shadow-orange-950/50">
            <Truck className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
            KAMAZ City Simulator <span className="text-cyan-400">2D</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-mono">
            Живой город, грузы, мультиплеер — прямо в браузере
          </p>
        </div>

        {/* Feature badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-mono text-slate-300">
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-900/80 border border-slate-700/80">
            <Briefcase className="w-3 h-3 text-amber-400" /> Задания
          </span>
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-900/80 border border-slate-700/80">
            <Wrench className="w-3 h-3 text-cyan-400" /> Гараж
          </span>
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-900/80 border border-slate-700/80">
            <Users className="w-3 h-3 text-emerald-400" /> Мультиплеер
          </span>
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-900/80 border border-slate-700/80">
            <Moon className="w-3 h-3 text-indigo-400" /> День/Ночь
          </span>
        </div>

        {/* Play button */}
        <button
          id="btn-play"
          onClick={onPlay}
          disabled={!ready || blocked}
          className={`w-full max-w-xs min-h-14 flex items-center justify-center gap-2 text-lg font-extrabold rounded-2xl shadow-2xl transition-all cursor-pointer ${
            ready && !blocked
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black active:scale-95'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {blocked ? (
            <span className="text-sm font-mono">Автоматический запуск не поддерживается</span>
          ) : ready ? (
            <>▶ Играть</>
          ) : (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm font-mono">Загрузка...</span>
            </>
          )}
        </button>

        {/* Rotating tip */}
        <div
          key={tipIndex}
          className="animate-[fadeIn_0.3s_ease-out] flex items-center gap-2 text-xs text-slate-300 bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2 min-h-10 max-w-sm"
        >
          <Volume2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>{tips[tipIndex]}</span>
        </div>

        <p className="text-[10px] text-slate-600 font-mono">
          Работает прямо в браузере — ничего скачивать не нужно
        </p>
      </div>

      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
        {showSettings && (
          <section className="w-64 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-left shadow-2xl shadow-black/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
                {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-cyan-400" />}
                Звук
              </h2>
              <button
                type="button"
                onClick={onToggleMute}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-mono text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300"
                aria-pressed={isMuted}
              >
                {isMuted ? 'Включить' : 'Выключить'}
              </button>
            </div>
            <label className="block text-xs text-slate-400" htmlFor="main-menu-volume">
              Громкость: <span className="font-mono text-slate-200">{Math.round(volume * 100)}%</span>
            </label>
            <input
              id="main-menu-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="mt-2 w-full accent-cyan-400"
            />
          </section>
        )}
        <button
          type="button"
          onClick={() => setShowSettings((current) => !current)}
          aria-expanded={showSettings}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm font-bold text-slate-300 shadow-lg transition hover:border-cyan-500 hover:text-cyan-300"
        >
          <Settings className="h-4 w-4" />
          Настройки
        </button>
      </div>
    </div>
  );
};
