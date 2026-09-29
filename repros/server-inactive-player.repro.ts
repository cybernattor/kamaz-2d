import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 3457;
const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), PLAYER_TIMEOUT_MS: '1000', DISABLE_HMR: 'true' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* still starting */ }
      await delay(200);
    }
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    let closeCode: number | undefined;
    socket.on('close', (code) => { closeCode = code; });
    await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'join', roomId: 'idle-room', name: 'Idle' }));

    // The player never sends an update; the 5s cleanup sweep must drop the
    // player AND the socket, otherwise the socket is stuck as "already joined".
    await delay(7000);
    const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json() as { totalPlayers: number };
    if (health.totalPlayers !== 0) throw new Error(`inactive player was not removed (${health.totalPlayers} left)`);
    if (closeCode !== 4000) throw new Error(`inactive player's socket was not closed with 4000 (got ${closeCode})`);
    console.log('FIXED: an inactive player is removed and its socket is closed so the client can reconnect.');
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
