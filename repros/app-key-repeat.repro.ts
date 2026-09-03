import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'App.tsx'), 'utf8');
const pressedState = source.indexOf('keysRef.current[e.code] = true;');
const repeatGuard = source.indexOf('if (e.repeat) return;', pressedState);
const actions = source.indexOf('// Handle Key Toggles', repeatGuard);

if (pressedState < 0 || repeatGuard < 0 || actions < 0 || !(pressedState < repeatGuard && repeatGuard < actions)) {
  throw new Error('Repeated keydown must retain movement state but not retrigger one-shot game actions.');
}

console.log('app-key-repeat: OK - held action keys fire once while movement remains held');
