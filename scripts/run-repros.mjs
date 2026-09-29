// Runs every repros/*.repro.ts and reports a summary. A repro passes when it
// exits with code 0. Usage: node scripts/run-repros.mjs [name-filter]
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2];
const files = readdirSync(path.join(root, 'repros'))
  .filter((name) => name.endsWith('.repro.ts') && (!filter || name.includes(filter)))
  .sort();

const run = (file) => new Promise((resolve) => {
  const started = Date.now();
  let output = '';
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', `repros/${file}`], { cwd: root });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => resolve({ file, code, output, seconds: (Date.now() - started) / 1000 }));
});

const failed = [];
for (const file of files) {
  const result = await run(file);
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${file} (${result.seconds.toFixed(1)}s)`);
  if (result.code !== 0) {
    failed.push(result);
    console.log(result.output.trim().split('\n').slice(-6).map((line) => `      ${line}`).join('\n'));
  }
}

console.log(`\n${files.length - failed.length}/${files.length} repros passed.`);
process.exit(failed.length === 0 ? 0 : 1);
