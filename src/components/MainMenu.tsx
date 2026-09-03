import React, { useEffect, useState } from 'react';
import { Truck, Users, Wrench, Briefcase, Moon, Volume2, Loader2 } from 'lucide-react';

interface MainMenuProps {
  isTouchDevice: boolean;
  onPlay: () => void;
}

const TIPS_DESKTOP = [
  'WASD — управление, [E] — сесть в машину или выйти из неё',
  'Берите задания [J] и зарабатывайте деньги на новые машины',
  'В гараже [G] можно сменить машину и её цвет',
  '[T] — переключить день/ночь, [L] — фары, [H] — гудок',
  'В скорой и полиции [J] включает сирену вместо заданий',
];

const TIPS_TOUCH = [
  'Джойстик снизу слева — руль, газ и тормоз',
  'Кнопка [E] в HUD — сесть в машину или выйти из неё',
  'Берите задания через кнопку в HUD и зарабатывайте деньги',
  'В гараже можно сменить машину и её цвет',
  'Кнопка сигнала — погудеть или включить сирену в спецтехнике',
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

export const MainMenu: React.FC<MainMenuProps> = ({ isTouchDevice, onPlay }) => {
  const { ready, blocked } = useHumanCheck();
  const tips = isTouchDevice ? TIPS_TOUCH : TIPS_DESKTOP;
  const [tipIndex, setTipIndex] = useState(0);

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
    </div>
  );
};
