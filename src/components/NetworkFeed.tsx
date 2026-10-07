import React from 'react';
import { MessageSquare, LogIn, LogOut } from 'lucide-react';
import { nameColorForId } from '../game/nameGenerator';

export interface FeedEvent {
  id: string;
  type: 'chat' | 'join' | 'leave';
  playerId: string;
  name: string;
  text?: string;
  // Lifetime in ms; drives the fade-out so it ends exactly when App.tsx
  // removes the event. Falls back to a plain toast without a fade.
  ttl?: number;
  // A chat line written by another player (as opposed to a system notice).
  incoming?: boolean;
}

interface NetworkFeedProps {
  events: FeedEvent[];
}

const FADE_OUT_MS = 1200;

function lifetimeAnimation(ev: FeedEvent, entry: string) {
  if (!ev.ttl) return entry;
  return `${entry}, feedFadeOut ${FADE_OUT_MS}ms ease-in ${Math.max(0, ev.ttl - FADE_OUT_MS)}ms forwards`;
}

/**
 * On-screen radio feed: chat lines and join/leave announcements, so you see
 * them while driving instead of only inside the multiplayer modal. Each event
 * is pushed once by App.tsx and expires itself (see FEED_EVENT_TTL_MS there);
 * this component just renders whatever is still in the list, oldest on top.
 * Older lines are dimmed so the newest message always stands out.
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
      {events.map((ev, index) => {
        const color = nameColorForId(ev.playerId);
        const isLatest = index === events.length - 1;
        const dim = isLatest ? 1 : Math.max(0.55, 1 - (events.length - 1 - index) * 0.12);

        if (ev.type === 'chat') {
          const incoming = Boolean(ev.incoming);
          return (
            <div
              key={ev.id}
              style={{
                opacity: dim,
                animation: lifetimeAnimation(
                  ev,
                  incoming ? 'feedSlideIn 0.28s ease-out, feedGlow 1.4s ease-out' : 'fadeIn 0.2s ease-out'
                ),
              }}
              className={`rounded-xl border backdrop-blur px-3.5 py-2 font-mono shadow-lg ${
                incoming
                  ? 'border-cyan-400/70 bg-slate-950/90 text-sm'
                  : 'border-slate-800 bg-slate-950/80 text-xs'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <MessageSquare className={`shrink-0 ${incoming ? 'w-3.5 h-3.5 text-cyan-300' : 'w-3 h-3 text-emerald-400'}`} />
                <span className="font-bold truncate" style={{ color }}>{ev.name}</span>
              </div>
              <div className={`break-words ${incoming ? 'text-white' : 'text-slate-200'}`}>{ev.text}</div>
            </div>
          );
        }

        const isJoin = ev.type === 'join';
        return (
          <div
            key={ev.id}
            style={{ opacity: dim, animation: lifetimeAnimation(ev, 'fadeIn 0.2s ease-out') }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-mono shadow-lg flex items-center gap-1.5 ${
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
