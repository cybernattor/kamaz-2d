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
      // Sits in the HUD's normal flex flow, directly above the controls-legend
      // panel (see HUD.tsx) — anchored there instead of at a guessed pixel
      // offset so it never overlaps it or the minimap, at any screen size.
      className="pointer-events-none w-full sm:max-w-md flex flex-col gap-1.5"
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
