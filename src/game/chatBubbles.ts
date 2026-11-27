/**
 * Overhead chat bubbles (Roblox / arras.io style): a message pops up above the
 * speaker's head, older messages are pushed up the stack and everything fades
 * out after a few seconds. Shared by the Canvas and Pixi renderers so both
 * draw the same thing; the store lives outside React so a chat message never
 * triggers a component re-render.
 */

export const CHAT_BUBBLE_LIFETIME_MS = 9000;
export const CHAT_BUBBLE_FADE_MS = 1200;
export const CHAT_BUBBLE_MAX_STACK = 3;
export const CHAT_BUBBLE_MAX_WIDTH = 150;
export const CHAT_BUBBLE_FONT_SIZE = 12;
export const CHAT_BUBBLE_PAD_X = 8;
export const CHAT_BUBBLE_PAD_Y = 5;
export const CHAT_BUBBLE_GAP = 3;
export const CHAT_BUBBLE_TAIL = 5;

interface StoredBubble {
  text: string;
  at: number;
}

export interface ActiveChatBubble {
  text: string;
  /** 0..1, fades to 0 as the bubble expires. */
  alpha: number;
  /** Stable per-message key so renderers can pool views. */
  key: string;
}

const bubbles = new Map<string, StoredBubble[]>();
let localPlayerId = '';

export function setLocalChatPlayerId(id: string) {
  localPlayerId = id;
}

export function getLocalChatPlayerId() {
  return localPlayerId;
}

export function addChatBubble(playerId: string, text: string, now = Date.now()) {
  const clean = text.trim();
  if (!playerId || !clean) return;
  const list = bubbles.get(playerId) ?? [];
  list.push({ text: clean, at: now });
  // Keep a little history beyond what is drawn so an expiring one can fade.
  while (list.length > CHAT_BUBBLE_MAX_STACK + 1) list.shift();
  bubbles.set(playerId, list);
}

export function clearChatBubbles(playerId?: string) {
  if (playerId) bubbles.delete(playerId);
  else bubbles.clear();
}

/** Active bubbles for a player, oldest first (newest is closest to the head). */
export function getChatBubbles(playerId: string, now = Date.now()): ActiveChatBubble[] {
  const list = bubbles.get(playerId);
  if (!list) return [];
  const live = list.filter((b) => now - b.at < CHAT_BUBBLE_LIFETIME_MS);
  if (live.length !== list.length) {
    if (live.length) bubbles.set(playerId, live);
    else bubbles.delete(playerId);
  }
  return live.slice(-CHAT_BUBBLE_MAX_STACK).map((b) => {
    const remaining = CHAT_BUBBLE_LIFETIME_MS - (now - b.at);
    const alpha = Math.max(0, Math.min(1, remaining / CHAT_BUBBLE_FADE_MS));
    // Quick pop-in so a new message does not just blink into existence.
    const age = now - b.at;
    const pop = Math.min(1, age / 120);
    return { text: b.text, alpha: alpha * (0.4 + 0.6 * pop), key: `${b.at}:${b.text}` };
  });
}

export function hasChatBubbles(playerId: string) {
  return bubbles.has(playerId);
}

/** Greedy word wrap; very long words are split so they never overflow. */
export function wrapChatText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  const pushWord = (word: string) => {
    while (measure(word) > maxWidth && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) cut--;
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  };
  for (const word of text.split(/\s+/)) if (word) pushWord(word);
  if (line) lines.push(line);
  return lines;
}
