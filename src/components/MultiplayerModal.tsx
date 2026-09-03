import React, { useState } from 'react';
import { ChatMessage, RemotePlayer } from '../types';
import { X, Users, MessageSquare, Send, Globe, Wifi, Radio, UserCheck } from 'lucide-react';
import { nameColorForId } from '../game/nameGenerator';

interface MultiplayerModalProps {
  status: 'disconnected' | 'connecting' | 'connected';
  playerName: string;
  myPlayerId: string | null;
  onUpdatePlayerName: (name: string) => void;
  currentRoomId: string;
  onJoinRoom: (roomId: string) => void;
  remotePlayers: RemotePlayer[];
  chatMessages: ChatMessage[];
  onSendChat: (text: string) => void;
  onClose: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  status,
  playerName,
  myPlayerId,
  onUpdatePlayerName,
  currentRoomId,
  onJoinRoom,
  remotePlayers,
  chatMessages,
  onSendChat,
  onClose,
}) => {
  const [nameInput, setNameInput] = useState(playerName);
  const [roomInput, setRoomInput] = useState(currentRoomId);
  const [chatInput, setChatInput] = useState('');

  const quickPhrases = [
    'Погнали на стройку!',
    'Посигналь!',
    'Красивый КАМАЗ!',
    'Нужна помощь с грузом!',
    'Уступи дорогу!',
    'Еду в автосервис!',
  ];

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput.trim());
    setChatInput('');
  };

  return (
    <div
      id="modal-multiplayer-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
    >
      <div
        id="modal-multiplayer-card"
        className="bg-slate-900 border-2 border-emerald-500/80 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Мультиплеер (Сетевой Город)</h3>
              <p className="text-xs text-slate-400">
                Катайтесь с друзьями в реальном времени, возите грузы вместе и общайтесь по рации
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
                status === 'connected'
                  ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-500 text-rose-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`} />
              <span>{status === 'connected' ? 'Сервер Онлайн' : 'Подключение...'}</span>
            </div>

            <button
              id="btn-close-multiplayer"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-y-auto">
          {/* Left Column: Room & Profile Settings */}
          <div className="md:col-span-5 space-y-4">
            {/* Nickname Form */}
            <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
              <label className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-cyan-400" />
                Ваш Позывной / Никнейм:
              </label>
              <div className="flex gap-2">
                <input
                  id="input-player-name"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  placeholder="Дальнобойщик..."
                  maxLength={18}
                />
                <button
                  id="btn-save-name"
                  onClick={() => onUpdatePlayerName(nameInput)}
                  className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-mono font-bold cursor-pointer transition-colors"
                >
                  OK
                </button>
              </div>
            </div>

            {/* Room Switcher */}
            <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
              <label className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-emerald-400" />
                Комната / Номер Сервера:
              </label>
              <div className="flex gap-2">
                <input
                  id="input-room-id"
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="default"
                />
                <button
                  id="btn-join-room"
                  onClick={() => onJoinRoom(roomInput)}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-mono font-bold cursor-pointer transition-colors"
                >
                  Войти
                </button>
              </div>
            </div>

            {/* Connected Drivers List */}
            <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="text-xs font-mono text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Wifi className="w-4 h-4 text-amber-400" />
                  Игроки в Сети ({remotePlayers.length + 1})
                </span>
                <span className="text-[10px] text-slate-500">Комната: #{currentRoomId}</span>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {/* You */}
                <div className="p-2 rounded-lg bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-between text-xs font-mono">
                  <span className="font-bold" style={{ color: nameColorForId(myPlayerId) }}>★ {playerName} (Вы)</span>
                  <span className="text-emerald-400 font-mono">0 ms</span>
                </div>

                {/* Remote Players */}
                {remotePlayers.map((rp) => (
                  <div
                    key={rp.id}
                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs font-mono"
                  >
                    <span className="font-bold" style={{ color: nameColorForId(rp.id) }}>{rp.name}</span>
                    <span className="text-slate-400">{rp.vehicleType}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Live Radio / Chat */}
          <div className="md:col-span-7 flex flex-col h-[400px] bg-slate-950/70 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>Рация Водителей (Чат Комнаты)</span>
              </div>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-3 text-xs">
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-500 font-mono pt-12">
                  Эфир рации свободен. Напишите сообщение или нажмите быструю фразу!
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 font-mono">
                    <span className="font-bold mr-1.5" style={{ color: nameColorForId(msg.playerId) }}>{msg.name}:</span>
                    <span className="text-slate-200">{msg.text}</span>
                  </div>
                ))
              )}
            </div>

            {/* Quick Radio Phrases */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quickPhrases.map((phrase) => (
                <button
                  key={phrase}
                  onClick={() => onSendChat(phrase)}
                  className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
                >
                  {phrase}
                </button>
              ))}
            </div>

            {/* Input form */}
            <form onSubmit={handleSend} className="flex gap-2">
              <input
                id="input-chat-message"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Сообщение в рацию..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                id="btn-send-chat"
                type="submit"
                className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
