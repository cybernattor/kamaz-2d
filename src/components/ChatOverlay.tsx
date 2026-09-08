import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Settings, Users, X } from 'lucide-react';
import { ChatMessage, RemotePlayer } from '../types';
import { nameColorForId } from '../game/nameGenerator';

interface ChatOverlayProps {
  status: 'disconnected' | 'connecting' | 'connected';
  onlineCount: number;
  chatMessages: ChatMessage[];
  remotePlayers: RemotePlayer[];
  playerName: string;
  onSendChat: (text: string) => void;
  onClose: () => void;
  onOpenNetworkSettings: () => void;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({
  status, onlineCount, chatMessages, remotePlayers, playerName, onSendChat, onClose, onOpenNetworkSettings,
}) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSendChat(text);
    setValue('');
  };

  return (
    <div id="chat-overlay" className="pointer-events-auto absolute left-2 top-[58px] z-30 w-[min(360px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-emerald-400/30 bg-slate-950/65 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <MessageSquare className="h-4 w-4 text-emerald-300" />
          <span>Рация</span>
          <span className={`h-1.5 w-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="font-mono text-[10px] text-slate-400">{onlineCount + 1} в эфире</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onOpenNetworkSettings} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-cyan-300" aria-label="Настройки рации"><Settings className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Закрыть рацию"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="max-h-44 space-y-1 overflow-y-auto px-3 py-2 text-xs">
        {chatMessages.length === 0 ? <p className="py-4 text-center text-slate-500">Эфир свободен. Напишите сообщение.</p> : chatMessages.slice(-12).map((message) => (
          <div key={message.id} className="rounded-lg bg-white/[0.06] px-2 py-1.5"><span className="mr-1.5 font-bold" style={{ color: nameColorForId(message.playerId) }}>{message.name}:</span><span className="text-slate-200">{message.text}</span></div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-white/10 p-2">
        <input ref={inputRef} id="chat-overlay-input" value={value} onChange={(event) => setValue(event.target.value)} placeholder={`Сообщение от ${playerName}…`} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/60" />
        <button type="submit" className="rounded-lg bg-emerald-600 px-2.5 text-white hover:bg-emerald-500" aria-label="Отправить сообщение"><Send className="h-4 w-4" /></button>
      </form>
      <div className="flex items-center gap-1 px-3 pb-2 text-[10px] text-slate-500"><Users className="h-3 w-3" /> Enter — открыть · Esc — закрыть</div>
    </div>
  );
};
