import { MultiplayerClient } from '../src/network/multiplayerClient';
import { RemotePlayer } from '../src/types';

/**
 * Remote cars are drawn from a 20Hz stream on a 60fps display. Without
 * interpolation each position is held for three frames and then jumps, which is
 * the stutter this guards against.
 */
const failures: string[] = [];

const basePlayer = (id: string): RemotePlayer => ({
  id,
  name: 'Test',
  x: 0,
  y: 0,
  angle: 0,
  speed: 0,
  steering: 0,
  inVehicle: true,
  vehicleType: 'kamaz_dump',
  vehicleColor: '#f97316',
  condition: 100,
  headlights: 1,
  turnSignal: 'none',
  isHonking: false,
  isSiren: false,
  lastUpdate: Date.now(),
});

const client = new MultiplayerClient('Test');
// The buffer and the render clock are internal; a repro is allowed to reach in.
const internals = client as unknown as {
  buffers: Map<string, Array<{ t: number; x: number; y: number; angle: number; speed: number; steering: number }>>;
  remotePlayers: Map<string, RemotePlayer>;
};

const seed = (id: string, samples: Array<{ offset: number; x: number; y: number; angle: number }>) => {
  const now = performance.now();
  internals.remotePlayers.set(id, basePlayer(id));
  internals.buffers.set(
    id,
    samples.map((sample) => ({
      t: now + sample.offset,
      x: sample.x,
      y: sample.y,
      angle: sample.angle,
      speed: 0,
      steering: 0,
    }))
  );
};

// 1. A position between two samples is interpolated, not snapped. Render time is
// now-100ms, which sits halfway between a sample at -200ms and one at 0ms.
seed('lerp', [
  { offset: -200, x: 0, y: 0, angle: 0 },
  { offset: 0, x: 100, y: 200, angle: 0 },
]);
const lerped = client.getInterpolatedPlayers().find((p) => p.id === 'lerp');
if (!lerped) {
  failures.push('interpolated player was not returned at all');
} else {
  if (Math.abs(lerped.x - 50) > 8) failures.push(`x should interpolate to ~50, got ${lerped.x.toFixed(1)}`);
  if (Math.abs(lerped.y - 100) > 16) failures.push(`y should interpolate to ~100, got ${lerped.y.toFixed(1)}`);
  if (lerped.x === 0 || lerped.x === 100) failures.push('position snapped to a sample instead of interpolating');
}

// 2. Angles take the shortest arc. A naive lerp from 3.0 to -3.0 sweeps through
// zero, spinning the car the long way round.
internals.buffers.clear();
internals.remotePlayers.clear();
seed('wrap', [
  { offset: -200, x: 0, y: 0, angle: 3.0 },
  { offset: 0, x: 0, y: 0, angle: -3.0 },
]);
const wrapped = client.getInterpolatedPlayers().find((p) => p.id === 'wrap');
if (!wrapped) {
  failures.push('angle-wrap player was not returned');
} else if (Math.abs(wrapped.angle) < 2.5) {
  failures.push(`angle took the long way round: expected magnitude near pi, got ${wrapped.angle.toFixed(2)}`);
}

// 3. With nothing newer than the render time, the last known state is held
// rather than extrapolated forward into a wall.
internals.buffers.clear();
internals.remotePlayers.clear();
seed('stale', [
  { offset: -900, x: 10, y: 20, angle: 0 },
  { offset: -800, x: 30, y: 40, angle: 0 },
]);
const stale = client.getInterpolatedPlayers().find((p) => p.id === 'stale');
if (!stale) {
  failures.push('stale player was not returned');
} else if (stale.x !== 30 || stale.y !== 40) {
  failures.push(`stale player should hold the last sample (30,40), got (${stale.x}, ${stale.y})`);
}

// 4. A player with no samples yet still renders at its join position.
internals.buffers.clear();
internals.remotePlayers.clear();
const fresh = basePlayer('fresh');
fresh.x = 777;
fresh.y = 888;
internals.remotePlayers.set('fresh', fresh);
const unbuffered = client.getInterpolatedPlayers().find((p) => p.id === 'fresh');
if (!unbuffered || unbuffered.x !== 777 || unbuffered.y !== 888) {
  failures.push('a player with no samples yet did not fall back to its known position');
}

if (failures.length > 0) {
  throw new Error(`MULTIPLAYER_INTERPOLATION_FAILED\n${failures.join('\n')}`);
}

console.log('FIXED: remote players interpolate between snapshots, wrap angles the short way, and hold instead of extrapolating.');
