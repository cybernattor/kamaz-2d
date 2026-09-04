import React, { useState } from 'react';
import { VehicleCategory, VehicleConfig } from '../types';
import { VEHICLE_CONFIGS } from '../game/vehicleConfigs';
import { X, Check, Gauge, Shield, Zap, Package, Sparkles } from 'lucide-react';

interface GarageModalProps {
  currentVehicleType: VehicleCategory;
  currentColor: string;
  onSelectVehicle: (type: VehicleCategory, color: string) => void;
  onClose: () => void;
}

export const GarageModal: React.FC<GarageModalProps> = ({
  currentVehicleType,
  currentColor,
  onSelectVehicle,
  onClose,
}) => {
  const [selectedType, setSelectedType] = useState<VehicleCategory>(currentVehicleType);
  const [selectedColor, setSelectedColor] = useState<string>(currentColor);

  const selectedConfig = VEHICLE_CONFIGS[selectedType];

  const colorPalette = [
    { name: 'КАМАЗ Оранжевый', hex: '#f97316' },
    { name: 'КАМАЗ Синий', hex: '#0284c7' },
    { name: 'Изумрудный', hex: '#0d9488' },
    { name: 'Ярко-Красный', hex: '#e11d48' },
    { name: 'Городской Жёлтый', hex: '#eab308' },
    { name: 'Глубокий Пурпурный', hex: '#9333ea' },
    { name: 'Белый Перламутр', hex: '#ffffff' },
    { name: 'Тёмный Графит', hex: '#334155' },
    { name: 'ДПС Ночной', hex: '#0f172a' },
  ];

  const vehiclesList = Object.values(VEHICLE_CONFIGS);

  return (
    <div
      id="modal-garage-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
    >
      <div
        id="modal-garage-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-garage-title"
        className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="modal-garage-title" className="text-lg font-bold text-slate-100">Автопарк и Тюнинг Гараж</h3>
              <p className="text-xs text-slate-400">Выберите грузовик или авто для свободного исследования и миссий</p>
            </div>
          </div>

          <button
            id="btn-close-garage"
            onClick={onClose}
            aria-label="Закрыть гараж"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-y-auto">
          {/* Left Column: Vehicle Selector List */}
          <div className="md:col-span-5 space-y-2 max-h-[500px] overflow-y-auto pr-1">
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2">
              Доступная Техника ({vehiclesList.length})
            </div>

            {vehiclesList.map((cfg) => {
              const isSelected = cfg.id === selectedType;
              return (
                <button
                  key={cfg.id}
                  id={`btn-select-vehicle-${cfg.id}`}
                  onClick={() => {
                    setSelectedType(cfg.id);
                    if (cfg.id === 'ambulance') setSelectedColor('#ffffff');
                    else if (cfg.id === 'police') setSelectedColor('#0f172a');
                    else if (cfg.id === 'kamaz_dump') setSelectedColor('#f97316');
                    else if (cfg.id === 'kamaz_flatbed') setSelectedColor('#0284c7');
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500 text-white shadow-lg'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="font-bold text-sm">{cfg.nameRu}</div>
                    <div className="text-xs text-slate-400 font-mono">{cfg.name}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                      {cfg.maxSpeed} км/ч
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-amber-400" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Column: Vehicle Details & Customization */}
          <div className="md:col-span-7 space-y-5 bg-slate-950/60 rounded-xl p-5 border border-slate-800">
            {/* Title & Description */}
            <div>
              <h2 className="text-xl font-bold text-amber-400 mb-1">{selectedConfig.nameRu}</h2>
              <p className="text-xs text-slate-300 leading-relaxed">{selectedConfig.description}</p>
            </div>

            {/* Vehicle Specs Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 flex items-center gap-3">
                <Gauge className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-mono">Макс. Скорость</div>
                  <div className="text-base font-bold text-slate-100 font-mono">{selectedConfig.maxSpeed} км/ч</div>
                </div>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-400" />
                <div>
                <div className="text-[10px] text-slate-400 uppercase font-mono">Ускорение</div>
                  <div className="text-base font-bold text-slate-100 font-mono">{selectedConfig.acceleration.toFixed(1)} м/с²</div>
                </div>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 flex items-center gap-3">
                <Shield className="w-5 h-5 text-emerald-400" />
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-mono">Прочность Рамы</div>
                  <div className="text-base font-bold text-slate-100 font-mono">{selectedConfig.durability} HP</div>
                </div>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 flex items-center gap-3">
                <Package className="w-5 h-5 text-indigo-400" />
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-mono">Масса ТС</div>
                  <div className="text-base font-bold text-slate-100 font-mono">{(selectedConfig.mass / 1000).toFixed(1)} т</div>
                </div>
              </div>
            </div>

            {/* Color Customization */}
            <div className="space-y-2">
              <div className="text-xs font-mono text-slate-300">Цвет Кузова / Кабины:</div>
              <div className="flex flex-wrap gap-2">
                {colorPalette.map((col) => (
                  <button
                    key={col.hex}
                    id={`btn-color-${col.hex.replace('#', '')}`}
                    onClick={() => setSelectedColor(col.hex)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform cursor-pointer flex items-center justify-center ${
                      selectedColor === col.hex ? 'scale-115 border-white shadow-lg' : 'border-slate-700 hover:scale-105'
                    }`}
                    style={{ backgroundColor: col.hex }}
                    title={col.name}
                  >
                    {selectedColor === col.hex && (
                      <Check className={`w-4 h-4 ${col.hex === '#ffffff' ? 'text-slate-900' : 'text-white'}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm & Drive Button */}
            <div className="pt-3">
              <button
                id="btn-confirm-garage-vehicle"
                onClick={() => {
                  onSelectVehicle(selectedType, selectedColor);
                  onClose();
                }}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold text-sm tracking-wide shadow-xl transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" />
                <span>Выбрать и Выехать в Город</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
