import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';

type ServerMessage = {
  type: string;
  yourId?: string;
  tickHz?: number;
  player?: { id?: string; name?: string };
  players?: Array<Record<string, unknown> & { id?: string }>;
  playerId?: string;
  objectId?: string;
  name?: string;
  text?: string;
};

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');
const REAL_PROP_ID = 'prop_cone_0';
const failures: string[] = [];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port: number, roomId: string, name: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'join', roomId, name, playerId: 'client-chosen-id' }));

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const init = messages.find((m) => m.type === 'init');
    if (init) return { socket, messages, id: init.yourId ?? '', tickHz: init.tickHz ?? 0 };
    await delay(10);
  }
  throw new Error(`${name} never received init`);
}

const latestSnapshotFor = (messages: ServerMessage[], id: string) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'snapshot') continue;
    const entry = message.players?.find((p) => p.id === id);
    if (entry) return entry;
  }
  return undefined;
};

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
    server.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    server.stderr?.on('data', (chunk) => { output += chunk.toString(); });

    let port: number | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const match = output.match(/listening on port (\d+)/i);
      if (match) { port = Number(match[1]); break; }
      await delay(100);
    }
    if (!port) throw new Error(`Server never reported a port. Output: ${output}`);

    const a = await connect(port, 'protocol-test', 'Alpha');
    const b = await connect(port, 'protocol-test', 'Beta');
    alpha = a.socket;
    beta = b.socket;
    await delay(100);

    // 1. The server assigns identity; a client-supplied id is ignored, so one
    // player cannot claim another's state.
    if (a.id === 'client-chosen-id' || b.id === 'client-chosen-id') {
      failures.push('server accepted a client-supplied playerId');
    }
    if (!a.tickHz) failures.push('init did not advertise the snapshot tick rate');

    // 2. A normal update reaches the other player in the room as a snapshot.
    b.messages.length = 0;
    alpha.send(JSON.stringify({
      type: 'update', x: 1234.56789, y: 456.4321, angle: 1.5, speed: 12.3, steering: 0.2,
      inVehicle: true, condition: 90, headlights: 2, turnSignal: 'left',
      isHonking: false, isSiren: false,
    }));
    await delay(200);

    const clean = latestSnapshotFor(b.messages, a.id);
    if (!clean) {
      failures.push('a normal update never reached the other player in the room');
    } else {
      if (clean.x !== 1235 || clean.y !== 456) {
        failures.push(`snapshot coordinates are not rounded: x=${clean.x} y=${clean.y}`);
      }
      if (Object.prototype.hasOwnProperty.call(clean, 'vehicleColor')) {
        failures.push('snapshot still carries static fields that never change while driving');
      }
    }

    // 3. Garbage must not propagate. A single NaN out of the physics used to be
    // copied straight into every other client's renderer.
    b.messages.length = 0;
    alpha.send(JSON.stringify({
      type: 'update', x: NaN, y: 'abc', angle: null, speed: 1e12, steering: undefined,
      inVehicle: true, condition: 99999, headlights: 77, turnSignal: 'hax',
      isHonking: 'yes', isSiren: 1, speechText: 'x'.repeat(5000),
    }));
    await delay(200);

    const dirty = latestSnapshotFor(b.messages, a.id);
    if (dirty) {
      for (const field of ['x', 'y', 'angle', 'speed', 'steering']) {
        const value = dirty[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          failures.push(`snapshot field ${field} is not a finite number: ${String(value)}`);
        }
      }
      if (typeof dirty.x === 'number' && (dirty.x < 0 || dirty.x > 3600)) {
        failures.push(`snapshot x escaped the world bounds: ${dirty.x}`);
      }
      if (typeof dirty.condition === 'number' && dirty.condition > 100) {
        failures.push(`condition was not clamped: ${dirty.condition}`);
      }
      if (dirty.turnSignal !== 'none') {
        failures.push(`an unknown turn signal was accepted: ${String(dirty.turnSignal)}`);
      }
      if (dirty.isHonking !== true && dirty.isHonking !== false) {
        failures.push(`isHonking is not a boolean: ${String(dirty.isHonking)}`);
      }
    }
    const speech = b.messages.find((m) => m.type === 'speech');
    if (speech && (speech.text?.length ?? 0) > 200) {
      failures.push(`speech text was not capped: ${speech.text?.length} chars`);
    }

    // 4. Destroying an object that the map never generated must be refused,
    // otherwise it sits in room state until its respawn timer fires.
    b.messages.length = 0;
    alpha.send(JSON.stringify({ type: 'object_destroyed', objectId: 'not-a-real-prop' }));
    await delay(150);
    if (b.messages.some((m) => m.type === 'object_destroyed')) {
      failures.push('server broadcast a destroy for an object id that does not exist');
    }

    alpha.send(JSON.stringify({ type: 'object_destroyed', objectId: REAL_PROP_ID }));
    await delay(150);
    if (!b.messages.some((m) => m.type === 'object_destroyed' && m.objectId === REAL_PROP_ID)) {
      failures.push('a destroy for a real prop did not reach the room');
    }

    // 5. Chat identity comes from the server's player record.
    b.messages.length = 0;
    alpha.send(JSON.stringify({ type: 'chat', name: 'IMPOSTOR', text: 'hello' }));
    await delay(150);
    const chat = b.messages.find((m) => m.type === 'chat');
    if (!chat) failures.push('chat did not reach the room');
    else if (chat.name === 'IMPOSTOR') failures.push('chat used a client-supplied display name');

    // 6. Chat is rate limited.
    b.messages.length = 0;
    for (let i = 0; i < 15; i++) alpha.send(JSON.stringify({ type: 'chat', text: `spam ${i}` }));
    await delay(300);
    const spamCount = b.messages.filter((m) => m.type === 'chat').length;
    if (spamCount > 6) failures.push(`chat flood was not rate limited: ${spamCount} messages relayed`);

    // 7. The snapshot tick decouples inbound update rate from outbound traffic:
    // flooding updates must not multiply the messages every client receives.
    b.messages.length = 0;
    const floodStart = Date.now();
    for (let i = 0; i < 400; i++) {
      alpha.send(JSON.stringify({
        type: 'update', x: 1000 + i, y: 1000, angle: 0, speed: 5, steering: 0,
        inVehicle: true, condition: 100, headlights: 1, turnSignal: 'none',
        isHonking: false, isSiren: false,
      }));
    }
    await delay(1000);
    const elapsedSeconds = (Date.now() - floodStart) / 1000;
    const snapshots = b.messages.filter((m) => m.type === 'snapshot').length;
    const perSecond = snapshots / elapsedSeconds;
    if (perSecond > 30) {
      failures.push(`400 updates produced ${perSecond.toFixed(0)} snapshots/s; the tick is not decoupling the rate`);
    }
    if (snapshots === 0) failures.push('the snapshot tick stopped sending entirely under load');

    if (failures.length > 0) {
      throw new Error(`MULTIPLAYER_PROTOCOL_FAILED\n${failures.join('\n')}`);
    }
    console.log(
      `FIXED: server assigns ids, clamps every field, rejects unknown props, owns chat identity, and holds ${perSecond.toFixed(0)} snapshots/s under a 400-update flood.`
    );
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
