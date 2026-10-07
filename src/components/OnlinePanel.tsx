import React from 'react';
import { MessageSquare, Radio, Users } from 'lucide-react';
import { RemotePlayer } from '../types';
import { nameColorForId } from '../game/nameGenerator';

interface OnlinePanelProps {
  status: 'disconnected' | 'connecting' | 'connected';
  roomId: string;
  remotePlayers: RemotePlayer[];
  isTouchDevice: boolean;
  unreadChat: number;
  onOpenChat: () => void;
}

const MAX_LISTED = 6;

/**
 * Always-visible multiplayer status: who is in the room right now and where
 * the chat is. Chat lines used to show up only as short-lived toasts, so
 * nothing on screen told a new player the game is a shared live world.
 */
export const OnlinePanel: React.FC<OnlinePanelProps> = ({
  status, roomId, remotePlayers, isTouchDevice, unreadChat, onOpenChat,
}) => {
  const connected = status === 'connected';
  const total = remotePlayers.length + 1;
  const listed = remotePlayers.slice(0, MAX_LISTED);

  return (
    <div
      id="online-panel"
      className="pointer-events-auto flex w-40 max-w-[calc(100vw-1.5rem)] flex-col gap-1.5 rounded-lg border border-slate-800/80 bg-slate-950/90 p-2 text-[11px] font-mono shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-slate-600'}`} />
        </span>
        <span className={`font-bold tracking-wide ${connected ? 'text-emerald-300' : 'text-slate-400'}`}>
          {connected ? 'ОНЛАЙН' : status === 'connecting' ? 'ПОДКЛЮЧЕНИЕ…' : 'НЕТ СВЯЗИ'}
        </span>
        <button
          id="btn-online-panel-chat"
          onClick={onOpenChat}
          className="ml-auto flex shrink-0 items-center gap-1 rounded border border-cyan-500/40 bg-cyan-950/50 px-1.5 py-1 text-cyan-200 transition-colors hover:bg-cyan-900/60 cursor-pointer"
          aria-label="Открыть чат"
        >
          <MessageSquare className="w-3 h-3" />
          <span className="font-bold">Чат</span>
          {unreadChat > 0 && (
            <span className="min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-4 text-white animate-pulse">
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          )}
          {!isTouchDevice && <kbd className="rounded border border-cyan-400/40 px-1 text-[10px] text-cyan-300">↵</kbd>}
        </button>
      </div>

      {connected && (
        <div className="flex flex-col gap-1 border-t border-slate-800/70 pt-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-slate-300">
            <Users className="h-3 w-3 shrink-0 text-slate-500" />
            <span>{total} в комнате</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-slate-400" title={`Комната ${roomId}`}>
            <Radio className="h-3 w-3 shrink-0 text-slate-500" />
            <span className="truncate">{roomId}</span>
          </div>
          {listed.map((p) => (
            <span key={p.id} className="truncate pl-[18px] font-bold" style={{ color: nameColorForId(p.id) }}>{p.name}</span>
          ))}
          {remotePlayers.length > MAX_LISTED && <span className="pl-[18px] text-slate-500">+{remotePlayers.length - MAX_LISTED}</span>}
        </div>
      )}
    </div>
  );
};
