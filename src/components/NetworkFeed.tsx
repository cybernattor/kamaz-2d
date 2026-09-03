import React from 'react';
import { MessageSquare, LogIn, LogOut } from 'lucide-react';
import { nameColorForId } from '../game/nameGenerator';

export interface FeedEvent {
  id: string;
  type: 'chat' | 'join' | 'leave';
  playerId: string;
  name: string;
  text?: string;
}

interface NetworkFeedProps {
  events: FeedEvent[];
}

/**
 * On-screen radio feed: chat lines and join/leave announcements, so you see
 * them while driving instead of only inside the multiplayer modal. Each event
 * is pushed once by App.tsx and expires itself (see FEED_EVENT_TTL_MS there);
 * this component just renders whatever is still in the list, oldest on top.
 */
export const NetworkFeed: React.FC<NetworkFeedProps> = ({ events }) => {
  if (events.length === 0) return null;

  return (
    <div
      id="network-feed"
      // Below the HUD's top bar (street name + toggle row, minimap on the
      // right) so it doesn't get buried under those — top-right was tried
      // first but sat right behind the minimap radar there.
      className="pointer-events-none absolute top-40 sm:top-36 left-3 z-30 w-64 max-w-[80vw] flex flex-col gap-1.5"
      aria-live="polite"
    >
      {events.map((ev) => {
        const color = nameColorForId(ev.playerId);
        if (ev.type === 'chat') {
          return (
            <div
              key={ev.id}
              className="animate-[fadeIn_0.2s_ease-out] rounded-lg border border-slate-800 bg-slate-950/80 backdrop-blur px-3 py-1.5 text-xs font-mono shadow-lg"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <MessageSquare className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="font-bold truncate" style={{ color }}>{ev.name}</span>
              </div>
              <div className="text-slate-200 break-words">{ev.text}</div>
            </div>
          );
        }

        const isJoin = ev.type === 'join';
        return (
          <div
            key={ev.id}
            className={`animate-[fadeIn_0.2s_ease-out] rounded-lg border px-3 py-1.5 text-xs font-mono shadow-lg flex items-center gap-1.5 ${
              isJoin
                ? 'border-emerald-800 bg-emerald-950/70 text-emerald-300'
                : 'border-slate-800 bg-slate-950/70 text-slate-400'
            }`}
          >
            {isJoin ? <LogIn className="w-3 h-3 shrink-0" /> : <LogOut className="w-3 h-3 shrink-0" />}
            <span>
              <span className="font-bold" style={{ color }}>{ev.name}</span>
              {isJoin ? ' в эфире' : ' вышел из эфира'}
            </span>
          </div>
        );
      })}
    </div>
  );
};
