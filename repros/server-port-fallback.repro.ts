import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function main() {
  let blocker: Server | undefined;
  let app: ChildProcess | undefined;
  let usedExternalBlocker = false;

  try {
    blocker = createServer((_request, response) => response.end('port blocker'));
    try {
      await new Promise<void>((resolve, reject) => {
        blocker!.once('listening', () => resolve());
        blocker!.once('error', reject);
        blocker!.listen(3000, '0.0.0.0');
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw error;
      }
      usedExternalBlocker = true;
    }

    let output = '';
    app = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    app.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    app.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });

    let selectedPort: number | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const match = output.match(/listening on port (\d+)/i);
      if (match) {
        selectedPort = Number(match[1]);
        break;
      }
      await delay(100);
    }

    if (!selectedPort) {
      throw new Error(`INCONCLUSIVE: server did not report a selected port. Output: ${output}`);
    }
    if (selectedPort === 3000) {
      throw new Error('REPRODUCED: server selected occupied port 3000.');
    }

    const health = await fetch(`http://127.0.0.1:${selectedPort}/api/health`);
    if (!health.ok) {
      throw new Error(`Server selected port ${selectedPort}, but health check returned ${health.status}.`);
    }

    console.log(
      `FIXED: port 3000 was occupied (${usedExternalBlocker ? 'by an existing process' : 'by the test blocker'}); server selected port ${selectedPort}.`
    );
  } finally {
    app?.kill();
    await closeServer(blocker!);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
