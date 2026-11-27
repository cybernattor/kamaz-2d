/**
 * Night lighting model shared by the GPU renderer.
 *
 * The scene is lit with a light map: every frame the renderer clears an
 * off-screen texture to the ambient sky colour, adds soft light shapes on top
 * (headlight beams, street-lamp pools, neon, signals) and multiplies the
 * result over the world. Surfaces keep their own colour under a light instead
 * of being washed with a flat yellow overlay, and unlit areas fall into a
 * cool moonlit blue rather than plain grey.
 *
 * Light shapes are baked once into small greyscale canvases (white with an
 * intensity falloff in alpha) and tinted per light.
 */

export type LightShape = 'beam-low' | 'beam-high' | 'radial' | 'bar';

/** Beam textures are square; the apex sits on the left edge, mid-height. */
export const BEAM_TEXTURE_SIZE = 256;
export const RADIAL_TEXTURE_SIZE = 128;
export const BAR_TEXTURE_WIDTH = 128;
export const BAR_TEXTURE_HEIGHT = 32;

/** Beam reach in world units, per headlight mode. */
export const LOW_BEAM_LENGTH = 230;
export const HIGH_BEAM_LENGTH = 400;

type Rgb = readonly [number, number, number];

const DAY: Rgb = [1, 1, 1];
const DUSK: Rgb = [1, 0.74, 0.58];
const NIGHT: Rgb = [0.19, 0.22, 0.35];

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const toHex = ([r, g, b]: Rgb) =>
  (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);

/**
 * Ambient light for a blend between day (0) and full night (1). The middle of
 * the transition passes through a warm dusk tone, so toggling day/night reads
 * as a sunset instead of a dimmer switch.
 */
export const ambientColor = (nightAmount: number) => {
  const t = Math.min(1, Math.max(0, nightAmount));
  return toHex(t < 0.5 ? mix(DAY, DUSK, t * 2) : mix(DUSK, NIGHT, (t - 0.5) * 2));
};

/** How strongly artificial lights show for a given night blend. */
export const lightStrength = (nightAmount: number) => smoothstep(0.25, 1, nightAmount);

const paint = (
  width: number,
  height: number,
  intensityAt: (x: number, y: number) => number
) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.min(1, Math.max(0, intensityAt(x + 0.5, y + 0.5)));
      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(value * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const gaussian = (value: number, sigma: number) => Math.exp(-(value * value) / (2 * sigma * sigma));

/**
 * One headlamp's beam. Low beam is the European asymmetric pattern: a short,
 * sharp cut-off toward oncoming traffic (left, -Y) and a longer reach toward
 * the kerb (right, +Y). High beam is a narrow, long throw with a soft halo.
 */
const paintBeam = (high: boolean) => {
  const size = BEAM_TEXTURE_SIZE;
  const mid = size / 2;
  return paint(size, size, (x, y) => {
    const dx = x;
    const dy = y - mid;
    const r = Math.hypot(dx, dy) / size;
    if (r >= 1) return 0;
    const theta = Math.atan2(dy, dx);

    let angular: number;
    let reach: number;
    if (high) {
      angular = gaussian(theta, 0.13) * 0.85 + gaussian(theta, 0.34) * 0.3;
      reach = 1;
    } else {
      const kerbSide = theta > 0;
      angular = gaussian(theta - 0.04, kerbSide ? 0.27 : 0.17);
      // The kerb side throws further; the oncoming side is cut short.
      reach = kerbSide ? 1 : 0.78 + 0.22 * Math.max(0, 1 + theta / 0.5);
    }
    const along = r / reach;
    if (along >= 1) return 0;
    // Fade in from the lens, peak on the road a little ahead, then fall off.
    const lens = smoothstep(0, 0.05, r);
    const falloff = Math.pow(1 - along, high ? 0.75 : 0.9);
    const pool = 0.75 + 0.25 * gaussian(along - (high ? 0.32 : 0.24), 0.2);
    return Math.min(1, 1.35 * angular * lens * falloff * pool);
  });
};

/** Soft round light: bright core, long smooth tail, clean zero at the rim. */
const paintRadial = () => {
  const size = RADIAL_TEXTURE_SIZE;
  const mid = size / 2;
  return paint(size, size, (x, y) => {
    const r = Math.hypot(x - mid, y - mid) / mid;
    if (r >= 1) return 0;
    // Smooth bell with a long shoulder: bright core, wide usable pool.
    const shoulder = Math.pow(1 - smoothstep(0, 1, r), 1.6);
    return 0.8 * shoulder + 0.2 / (1 + 40 * r * r) * (1 - r);
  });
};

/** Elongated glow for neon trim and lit storefront edges. */
const paintBar = () =>
  paint(BAR_TEXTURE_WIDTH, BAR_TEXTURE_HEIGHT, (x, y) => {
    const u = x / BAR_TEXTURE_WIDTH;
    const v = (y - BAR_TEXTURE_HEIGHT / 2) / (BAR_TEXTURE_HEIGHT / 2);
    const ends = smoothstep(0, 0.12, u) * smoothstep(0, 0.12, 1 - u);
    return ends * gaussian(v, 0.38);
  });

export const createLightCanvas = (shape: LightShape) => {
  switch (shape) {
    case 'beam-low':
      return paintBeam(false);
    case 'beam-high':
      return paintBeam(true);
    case 'radial':
      return paintRadial();
    case 'bar':
      return paintBar();
  }
};

/** Halogen-warm by default; about a third of NPC cars run cooler LED lamps. */
export const HALOGEN = 0xfff0d2;
export const LED = 0xe6efff;
export const SODIUM = 0xffc27a;
export const TAIL_RED = 0xff2a14;
export const SIGNAL_AMBER = 0xffa31a;

export const headlampColor = (id: string, isPlayer: boolean) => {
  if (isPlayer) return HALOGEN;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 3 === 0 ? LED : HALOGEN;
};

export const signalColor = (state: 'green' | 'yellow' | 'red') =>
  state === 'red' ? 0xff3b2f : state === 'yellow' ? 0xffc21a : 0x2bff88;

export const colorFromCss = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};
