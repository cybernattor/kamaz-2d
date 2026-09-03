import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'game', 'pixiRenderer.ts'), 'utf8');
if (!source.includes('view.container.rotation = ped.angle + Math.PI / 2;')) {
  throw new Error('Pedestrian sprites must compensate for their up-facing local texture axis.');
}
console.log('pedestrian-orientation: OK - walkers face their movement direction');
