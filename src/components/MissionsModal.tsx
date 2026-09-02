import React from 'react';
import { Mission } from '../types';
import { X, Briefcase, Award, Clock, Truck, ShieldAlert, CheckCircle2, ChevronRight } from 'lucide-react';

interface MissionsModalProps {
  missions: Mission[];
  activeMission: Mission | null;
  playerMoney: number;
  playerLevel: number;
  onStartMission: (missionId: string) => void;
  onCancelMission: () => void;
  onClose: () => void;
}

export const MissionsModal: React.FC<MissionsModalProps> = ({
  missions,
  activeMission,
  playerMoney,
  playerLevel,
  onStartMission,
  onCancelMission,
  onClose,
}) => {
  return (
    <div
      id="modal-missions-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
    >
      <div
        id="modal-missions-card"
        className="bg-slate-900 border-2 border-cyan-500/80 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Биржа Заказов и Рейсов</h3>
              <p className="text-xs text-slate-400">Перевозка грузов на КАМАЗе, спецвызовы и задания в открытом мире</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right font-mono">
              <div className="text-xs text-slate-400">Баланс:</div>
              <div className="text-sm font-bold text-emerald-400">
                {playerMoney.toLocaleString()} ₽
              </div>
            </div>

            <button
              id="btn-close-missions"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Missions List */}
        <div className="p-6 space-y-3 overflow-y-auto max-h-[550px]">
          {missions.map((mis) => {
            const isActive = activeMission?.id === mis.id;
            const isCompleted = mis.status === 'completed';

            return (
              <div
                key={mis.id}
                id={`mission-card-${mis.id}`}
                className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isActive
                    ? 'bg-amber-500/10 border-amber-500 shadow-lg'
                    : isCompleted
                    ? 'bg-slate-950/40 border-slate-800/80 opacity-70'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                        mis.category === 'construction'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : mis.category === 'emergency'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : mis.category === 'delivery'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {mis.category}
                    </span>

                    {isActive && (
                      <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-amber-500 text-slate-950">
                        Выполняется Сейчас
                      </span>
                    )}

                    {isCompleted && (
                      <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Выполнено
                      </span>
                    )}
                  </div>

                  <h4 className="text-base font-bold text-slate-100">{mis.titleRu}</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">{mis.descriptionRu}</p>

                  <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400 pt-1">
                    {mis.cargoName && (
                      <span className="flex items-center gap-1 text-amber-300">
                        <Truck className="w-3.5 h-3.5" />
                        Груз: {mis.cargoName}
                      </span>
                    )}
                    {mis.timeLimitSeconds && (
                      <span className="flex items-center gap-1 text-slate-300">
                        <Clock className="w-3.5 h-3.5" />
                        Лимит: {mis.timeLimitSeconds} сек
                      </span>
                    )}
                  </div>
                </div>

                {/* Right Side: Rewards & Action */}
                <div className="flex md:flex-col items-center md:items-end justify-between gap-3 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
                  <div className="text-right">
                    <div className="text-base font-bold text-emerald-400 font-mono">
                      +{mis.rewardMoney.toLocaleString()} ₽
                    </div>
                    <div className="text-xs text-slate-400 font-mono">+{mis.rewardXp} XP</div>
                  </div>

                  {isActive ? (
                    <button
                      id={`btn-cancel-mission-${mis.id}`}
                      onClick={onCancelMission}
                      className="px-4 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 text-xs font-bold font-mono transition-colors cursor-pointer"
                    >
                      Отменить рейс
                    </button>
                  ) : (
                    <button
                      id={`btn-start-mission-${mis.id}`}
                      disabled={isCompleted}
                      onClick={() => {
                        onStartMission(mis.id);
                        onClose();
                      }}
                      className={`px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer ${
                        isCompleted
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg active:scale-95'
                      }`}
                    >
                      <span>Принять рейс</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
