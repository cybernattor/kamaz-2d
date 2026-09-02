import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A ref argument is evaluated on every render. Constructing the city inside
 * useRef(...) cost ~195ms per render and, at five HUD ticks a second, left the
 * main thread no room to draw - the game ran at ~14 FPS while its own render
 * work measured under 5ms. Engines must be built through a lazy factory.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'App.tsx'), 'utf8');

const eager = source.match(/useRef\s*(<[^>]*>)?\s*\(\s*new\s+\w+/g);
if (eager) {
  throw new Error(`engines constructed on every render: ${eager.join(', ')}`);
}

for (const engine of ['CityMap', 'TrafficAI', 'PhysicsEngine', 'MissionManager']) {
  if (!source.includes(`useLazyRef<${engine}>(() => new ${engine}`)) {
    throw new Error(`${engine} is not built through a lazy ref factory`);
  }
}

console.log('app-lazy-engines: OK - engines are constructed once, not per render');
