import React from 'react';
import { MessageSquare, Radio, Users } from 'lucide-react';
import { RemotePlayer } from '../types';
import { nameColorForId } from '../game/nameGenerator';

interface OnlinePanelProps {
  status: 'disconnected' | 'connecting' | 'connected';
  roomId: string;
  remotePlayers: RemotePlayer[];
  isTouchDevice: boolean;
  onOpenChat: () => void;
}

const MAX_LISTED = 6;

/**
 * Always-visible multiplayer status: who is in the room right now and where
 * the chat is. Chat lines used to show up only as short-lived toasts, so
 * nothing on screen told a new player the game is a shared live world.
 */
export const OnlinePanel: React.FC<OnlinePanelProps> = ({
  status, roomId, remotePlayers, isTouchDevice, onOpenChat,
}) => {
  const connected = status === 'connected';
  const total = remotePlayers.length + 1;
  const listed = remotePlayers.slice(0, MAX_LISTED);

  return (
    <div
      id="online-panel"
      className="pointer-events-auto w-full sm:max-w-md rounded-xl border border-slate-800/80 bg-slate-950/85 backdrop-blur px-3 py-2 text-xs font-mono shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-slate-600'}`} />
        </span>
        <span className={`font-bold tracking-wide ${connected ? 'text-emerald-300' : 'text-slate-400'}`}>
          {connected ? 'ОНЛАЙН' : status === 'connecting' ? 'ПОДКЛЮЧЕНИЕ…' : 'НЕТ СВЯЗИ'}
        </span>
        {connected && (
          <>
            <span className="text-slate-500">·</span>
            <span className="flex items-center gap-1 text-slate-200"><Users className="w-3 h-3" />{total}</span>
            <span className="text-slate-500">·</span>
            <span className="truncate text-slate-400" title={`Комната ${roomId}`}><Radio className="inline w-3 h-3 mr-1" />{roomId}</span>
          </>
        )}
        <button
          id="btn-online-panel-chat"
          onClick={onOpenChat}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-950/50 px-2 py-1 text-cyan-200 hover:bg-cyan-900/60 cursor-pointer"
          aria-label="Открыть чат"
        >
          <MessageSquare className="w-3 h-3" />
          <span className="font-bold">Чат</span>
          {!isTouchDevice && <kbd className="rounded border border-cyan-400/40 px-1 text-[10px] text-cyan-300">Enter</kbd>}
        </button>
      </div>

      {connected && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-slate-300">Вы</span>
          {listed.map((p) => (
            <span key={p.id} className="font-bold truncate max-w-[9rem]" style={{ color: nameColorForId(p.id) }}>{p.name}</span>
          ))}
          {remotePlayers.length > MAX_LISTED && (
            <span className="text-slate-500">+{remotePlayers.length - MAX_LISTED}</span>
          )}
          {remotePlayers.length === 0 && <span className="text-slate-500">пока вы одни — позовите друзей в эту комнату</span>}
        </div>
      )}
    </div>
  );
};
