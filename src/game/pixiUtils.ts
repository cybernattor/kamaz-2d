export type Bounds = { left: number; top: number; right: number; bottom: number };

export const colorNumber = (value: string | undefined, fallback = 0xffffff) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const isVisible = (x: number, y: number, width: number, height: number, bounds: Bounds) =>
  x + width / 2 >= bounds.left
  && x - width / 2 <= bounds.right
  && y + height / 2 >= bounds.top
  && y - height / 2 <= bounds.bottom;

export const lineVisible = (x1: number, y1: number, x2: number, y2: number, bounds: Bounds) =>
  Math.max(x1, x2) >= bounds.left
  && Math.min(x1, x2) <= bounds.right
  && Math.max(y1, y2) >= bounds.top
  && Math.min(y1, y2) <= bounds.bottom;
