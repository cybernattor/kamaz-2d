import { MultiplayerClient } from '../src/network/multiplayerClient';

/** Minimal WebSocket stand-in that records every instance the client opens. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.window = { location: { protocol: 'http:', host: 'localhost:3000' } };
globals.WebSocket = FakeSocket;

const failures: string[] = [];
const statuses: string[] = [];
const errors: string[] = [];
const client = new MultiplayerClient('Tester', {
  onStatusChange: (status) => statuses.push(status),
  onError: (code) => errors.push(code),
});

client.connect('room-a');
const first = FakeSocket.instances[0];
first.open();
first.receive({ type: 'init', yourId: 'p_1', players: [{ id: 'p_1' }, { id: 'p_2', x: 1, y: 1 }], destructibles: {} });

// Switching rooms must close the old socket and open exactly one new one.
client.connect('room-b');
const second = FakeSocket.instances[1];
if (!first.closed) failures.push('switching rooms left the previous socket open');
if (FakeSocket.instances.length !== 2) failures.push(`expected 2 sockets, got ${FakeSocket.instances.length}`);
if (client.remotePlayers.size !== 0) failures.push('players from the previous room were kept');

// The old socket's late close event must not clobber the new socket.
first.onclose?.();
second.open();
if (client.status !== 'connected') failures.push(`late close of the old socket changed status to ${client.status}`);
if (second.sent[0]?.roomId !== 'room-b') failures.push('the new socket did not join room-b');

// A refused join must not leave the client pretending to be connected.
second.receive({ type: 'error', code: 'room_full', message: 'Комната временно заполнена' });
if (errors[0] !== 'room_full') failures.push('room_full was not reported to the app');
if (client.status !== 'disconnected') failures.push(`status after room_full was ${client.status}`);
if (!second.closed) failures.push('the refused socket was not closed');

client.disconnect();
if (failures.length > 0) {
  console.error(`MULTIPLAYER_CLIENT_ROOMS_FAILED\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('FIXED: room switch replaces the socket cleanly, ignores stale close events and surfaces room_full.');
}
