import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'App.tsx'), 'utf8');
const modalRef = source.indexOf('const modalOpenRef = useRef(false);');
const modalGuard = source.indexOf('if (modalOpenRef.current) {');
const gameInput = source.indexOf('keysRef.current[e.code] = true;');
const escapeClose = source.indexOf("e.code === 'Escape'", modalGuard);

if (modalRef < 0 || modalGuard < 0 || gameInput < 0 || escapeClose < 0 || !(modalGuard < gameInput)) {
  throw new Error('Modal dialogs must block global driving shortcuts and support Escape to close.');
}

console.log('app-modal-input: OK - modal dialogs isolate game shortcuts and close on Escape');
