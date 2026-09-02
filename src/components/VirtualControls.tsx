import React from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Volume2, Shield, Wrench } from 'lucide-react';

interface VirtualControlsProps {
  onInput: (action: 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake' | 'horn', active: boolean) => void;
}

export const VirtualControls: React.FC<VirtualControlsProps> = ({ onInput }) => {
  return (
    <div id="virtual-controls-container" className="md:hidden fixed inset-x-0 bottom-4 pointer-events-none flex justify-between px-4 z-40">
      {/* Left Steering Pad */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          id="vbtn-left"
          onTouchStart={() => onInput('steerLeft', true)}
          onTouchEnd={() => onInput('steerLeft', false)}
          onTouchCancel={() => onInput('steerLeft', false)}
          onMouseDown={() => onInput('steerLeft', true)}
          onMouseUp={() => onInput('steerLeft', false)}
          onMouseLeave={() => onInput('steerLeft', false)}
          className="w-14 h-14 rounded-full bg-slate-900/85 border border-slate-700 text-white flex items-center justify-center active:bg-cyan-600 shadow-xl"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <button
          id="vbtn-right"
          onTouchStart={() => onInput('steerRight', true)}
          onTouchEnd={() => onInput('steerRight', false)}
          onTouchCancel={() => onInput('steerRight', false)}
          onMouseDown={() => onInput('steerRight', true)}
          onMouseUp={() => onInput('steerRight', false)}
          onMouseLeave={() => onInput('steerRight', false)}
          className="w-14 h-14 rounded-full bg-slate-900/85 border border-slate-700 text-white flex items-center justify-center active:bg-cyan-600 shadow-xl"
        >
          <ArrowRight className="w-6 h-6" />
        </button>
      </div>

      {/* Right Pedals (Gas, Brake, Handbrake) */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          id="vbtn-horn"
          onTouchStart={() => onInput('horn', true)}
          onTouchEnd={() => onInput('horn', false)}
          onTouchCancel={() => onInput('horn', false)}
          onMouseDown={() => onInput('horn', true)}
          onMouseUp={() => onInput('horn', false)}
          onMouseLeave={() => onInput('horn', false)}
          className="w-12 h-12 rounded-full bg-amber-600/80 border border-amber-500 text-white flex items-center justify-center active:bg-amber-500 shadow-xl"
        >
          <Volume2 className="w-5 h-5" />
        </button>

        <button
          id="vbtn-brake"
          onTouchStart={() => onInput('brake', true)}
          onTouchEnd={() => onInput('brake', false)}
          onTouchCancel={() => onInput('brake', false)}
          onMouseDown={() => onInput('brake', true)}
          onMouseUp={() => onInput('brake', false)}
          onMouseLeave={() => onInput('brake', false)}
          className="w-14 h-14 rounded-full bg-rose-700/85 border border-rose-600 text-white flex flex-col items-center justify-center active:bg-rose-600 shadow-xl font-mono text-[10px] font-bold"
        >
          <ArrowDown className="w-5 h-5" />
          <span>ТОРМОЗ</span>
        </button>

        <button
          id="vbtn-gas"
          onTouchStart={() => onInput('throttle', true)}
          onTouchEnd={() => onInput('throttle', false)}
          onTouchCancel={() => onInput('throttle', false)}
          onMouseDown={() => onInput('throttle', true)}
          onMouseUp={() => onInput('throttle', false)}
          onMouseLeave={() => onInput('throttle', false)}
          className="w-16 h-16 rounded-full bg-emerald-600/85 border border-emerald-500 text-white flex flex-col items-center justify-center active:bg-emerald-500 shadow-xl font-mono text-xs font-bold"
        >
          <ArrowUp className="w-6 h-6" />
          <span>ГАЗ</span>
        </button>
      </div>
    </div>
  );
};
