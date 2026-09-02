import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';

type ServerMessage = {
  type: string;
  player?: { id?: string };
  players?: Array<{ id?: string }>;
  yourId?: string;
  playerId?: string;
  objectId?: string;
  text?: string;
};

/** A real prop id: the server rejects destroy requests for unknown objects. */
const SHARED_PROP_ID = 'prop_cone_0';

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(port: number) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await delay(100);
  }
  throw new Error('The development server did not become ready on port 3000.');
}

async function connectToRoom(roomId: string, playerId: string, port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  socket.send(
    JSON.stringify({
      type: 'join',
      roomId,
      playerId,
      name: playerId,
    })
  );

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const init = messages.find((message) => message.type === 'init');
    if (init) {
      // The server assigns the id; the client no longer picks its own.
      return { socket, messages, assignedId: init.yourId ?? '' };
    }
    await delay(10);
  }

  socket.close();
  throw new Error(`Client ${playerId} did not receive an init message.`);
}

async function main() {
  let server: ChildProcess | undefined;
  let alpha: WebSocket | undefined;
  let beta: WebSocket | undefined;

  try {
    server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    server.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });

    let port: number | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const match = output.match(/listening on port (\d+)/i);
      if (match) {
        port = Number(match[1]);
        break;
      }
      await delay(100);
    }
    if (!port) {
      throw new Error(`The development server did not report a selected port. Output: ${output}`);
    }
    await waitForServer(port);

    const alphaClient = await connectToRoom('alpha', 'alpha-player', port);
    const betaClient = await connectToRoom('beta', 'beta-player', port);
    alpha = alphaClient.socket;
    beta = betaClient.socket;

    // Ignore the normal join handshake, then send events only from room alpha.
    await delay(100);
    alpha.send(JSON.stringify({ type: 'chat', name: 'alpha-player', text: 'alpha-only' }));
    alpha.send(
      JSON.stringify({
        type: 'update',
        x: 123,
        y: 456,
        angle: 0,
        speed: 10,
        steering: 0,
        inVehicle: true,
        vehicleType: 'kamaz_dump',
        vehicleColor: '#f97316',
        condition: 100,
        headlights: 1,
        turnSignal: 'none',
        isHonking: false,
        isSiren: false,
      })
    );
    alpha.send(JSON.stringify({ type: 'object_destroyed', objectId: SHARED_PROP_ID }));
    await delay(250);

    const alphaId = alphaClient.assignedId;
    const leakedMessages = betaClient.messages.filter((message) =>
      (message.type === 'chat' && message.text === 'alpha-only') ||
      (message.type === 'snapshot' && message.players?.some((p) => p.id === alphaId)) ||
      (message.type === 'player_joined' && message.player?.id === alphaId) ||
      (message.type === 'object_destroyed' && message.objectId === SHARED_PROP_ID)
    );

    if (leakedMessages.length > 0) {
      throw new Error(
        `REPRODUCED: beta received ${leakedMessages.map((message) => message.type).join(', ')} from alpha.`
      );
    }

    console.log('NOT_REPRODUCED: room-isolation contract held.');
  } finally {
    alpha?.close();
    beta?.close();
    server?.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
