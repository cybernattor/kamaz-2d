import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { CityMap, WORLD_SIZE } from './src/game/cityMap';

/** Snapshot broadcast rate. Clients interpolate between snapshots, so this is
 *  deliberately lower than any client's frame rate. */
const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
/** A client that stops sending is dropped after this long. */
const PLAYER_TIMEOUT_MS = 30_000;
/** Half-open TCP connections never fire 'close', so sockets are pinged. */
const HEARTBEAT_MS = 30_000;
const MAX_NAME_LENGTH = 24;
const MAX_CHAT_LENGTH = 200;
const MAX_SPEECH_LENGTH = 120;
/** Generous next to the client's ~22Hz, low enough to stop a runaway loop. */
const MAX_UPDATES_PER_SECOND = 40;
const MAX_CHATS_PER_10S = 5;

const TURN_SIGNALS = new Set(['none', 'left', 'right', 'hazard']);

/** The map is deterministic, so the server can name every destructible the
 *  clients know about and reject ids that were never generated. */
const knownDestructibleIds = new Set(new CityMap().destructibles.map((prop) => prop.id));

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const clampText = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.slice(0, maxLength) : '';

interface PlayerState {
  id: string;
  name: string;
  room: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  steering: number;
  inVehicle: boolean;
  vehicleType: string;
  vehicleColor: string;
  condition: number;
  headlights: number; // 0=off, 1=low, 2=high
  turnSignal: string; // 'none', 'left', 'right', 'hazard'
  isHonking: boolean;
  isSiren: boolean;
  speechText?: string;
  speechTime?: number;
  lastUpdate: number;
}

interface RoomData {
  id: string;
  name: string;
  players: Map<string, PlayerState>;
  /** Membership is tracked here so a broadcast does not have to scan and
   *  filter every socket connected to the whole server. */
  sockets: Set<WebSocket>;
  destructiblesState: Record<string, { destroyed: boolean; respawnAt: number }>;
  dirty: Set<string>;
}

const rooms = new Map<string, RoomData>();
const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 100;

function getStartPort() {
  const configuredPort = Number(process.env.PORT);
  return Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536
    ? configuredPort
    : DEFAULT_PORT;
}

async function listenOnAvailablePort(server: http.Server, startPort: number) {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = startPort + attempt;

    try {
      await new Promise<void>((resolve, reject) => {
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        const onError = (error: NodeJS.ErrnoException) => {
          server.removeListener('listening', onListening);
          reject(error);
        };

        server.once('listening', onListening);
        server.once('error', onError);
        server.listen(port, '0.0.0.0');
      });

      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }

  throw new Error(`No free port found between ${startPort} and ${startPort + MAX_PORT_ATTEMPTS - 1}.`);
}

function getOrCreateRoom(roomId: string, roomName?: string): RoomData {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      name: roomName || `City Room #${roomId}`,
      players: new Map(),
      sockets: new Set(),
      destructiblesState: {},
      dirty: new Set(),
    });
  }
  return rooms.get(roomId)!;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json());

  // API endpoints
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      activeRooms: rooms.size,
      totalPlayers: Array.from(rooms.values()).reduce((acc, r) => acc + r.players.size, 0),
    });
  });

  app.get('/api/rooms', (req, res) => {
    const list = Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      playerCount: r.players.size,
      players: Array.from(r.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        vehicleType: p.vehicleType,
      })),
    }));
    res.json(list);
  });

  // WebSocket Multiplayer Server
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const requestPath = request.url?.split('?')[0];
    if (requestPath !== '/ws') return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
  wss.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') {
      console.error('WebSocket server error:', error);
    }
  });

  /** Per-connection state the message handlers need. */
  interface ConnectionState {
    playerId: string;
    roomId: string;
    isAlive: boolean;
    updateWindowStart: number;
    updateCount: number;
    chatWindowStart: number;
    chatCount: number;
  }
  const connections = new Map<WebSocket, ConnectionState>();

  wss.on('connection', (ws: WebSocket) => {
    const state: ConnectionState = {
      playerId: '',
      roomId: '',
      isAlive: true,
      updateWindowStart: Date.now(),
      updateCount: 0,
      chatWindowStart: Date.now(),
      chatCount: 0,
    };
    connections.set(ws, state);
    ws.on('pong', () => { state.isAlive = true; });

    ws.on('message', (messageRaw: string) => {
      try {
        const msg = JSON.parse(messageRaw.toString());
        if (!msg || typeof msg.type !== 'string') return;

        switch (msg.type) {
          case 'join': {
            if (state.playerId) return; // already joined on this socket

            const roomId = clampText(msg.roomId, 40) || 'default';
            const room = getOrCreateRoom(roomId, clampText(msg.roomName, 40) || undefined);

            // The id is assigned here, never taken from the client. A
            // client-supplied id let anyone claim another player's identity
            // and overwrite their state.
            const playerId = `p_${Math.random().toString(36).slice(2, 10)}`;
            state.playerId = playerId;
            state.roomId = roomId;
            room.sockets.add(ws);

            const initialPlayer: PlayerState = {
              id: playerId,
              name: clampText(msg.name, MAX_NAME_LENGTH) || 'Дальнобойщик',
              room: roomId,
              x: clampNumber(msg.x, 0, WORLD_SIZE, 1200),
              y: clampNumber(msg.y, 0, WORLD_SIZE, 1200),
              angle: clampNumber(msg.angle, -Math.PI * 2, Math.PI * 2, 0),
              speed: 0,
              steering: 0,
              inVehicle: msg.inVehicle !== false,
              vehicleType: clampText(msg.vehicleType, 40) || 'kamaz_dump',
              vehicleColor: clampText(msg.vehicleColor, 20) || '#f97316',
              condition: 100,
              headlights: 1,
              turnSignal: 'none',
              isHonking: false,
              isSiren: false,
              lastUpdate: Date.now(),
            };

            room.players.set(playerId, initialPlayer);

            ws.send(
              JSON.stringify({
                type: 'init',
                yourId: playerId,
                tickHz: TICK_HZ,
                players: Array.from(room.players.values()),
                destructibles: room.destructiblesState,
              })
            );

            broadcastToRoom(roomId, { type: 'player_joined', player: initialPlayer }, ws);
            break;
          }

          case 'update': {
            if (!state.playerId) return;
            const room = rooms.get(state.roomId);
            const player = room?.players.get(state.playerId);
            if (!room || !player) return;

            // Server-side rate limit. The client throttles too, but that is
            // advisory: a runaway loop or a patched client would otherwise
            // flood the whole room.
            const now = Date.now();
            if (now - state.updateWindowStart >= 1000) {
              state.updateWindowStart = now;
              state.updateCount = 0;
            }
            if (++state.updateCount > MAX_UPDATES_PER_SECOND) return;

            // Every field is clamped. One NaN out of the physics used to be
            // copied straight into everyone else's renderer.
            player.x = clampNumber(msg.x, 0, WORLD_SIZE, player.x);
            player.y = clampNumber(msg.y, 0, WORLD_SIZE, player.y);
            player.angle = clampNumber(msg.angle, -Math.PI * 2, Math.PI * 2, player.angle);
            player.speed = clampNumber(msg.speed, -200, 200, player.speed);
            player.steering = clampNumber(msg.steering, -Math.PI, Math.PI, player.steering);
            player.condition = clampNumber(msg.condition, 0, 100, player.condition);
            player.headlights = clampNumber(msg.headlights, 0, 2, player.headlights);
            player.inVehicle = msg.inVehicle !== false;
            player.isHonking = msg.isHonking === true;
            player.isSiren = msg.isSiren === true;
            player.turnSignal = TURN_SIGNALS.has(msg.turnSignal) ? msg.turnSignal : 'none';
            player.lastUpdate = now;

            const vehicleType = clampText(msg.vehicleType, 40);
            const vehicleColor = clampText(msg.vehicleColor, 20);
            if (vehicleType && vehicleType !== player.vehicleType) {
              player.vehicleType = vehicleType;
              broadcastToRoom(state.roomId, { type: 'player_meta', playerId: player.id, vehicleType }, ws);
            }
            if (vehicleColor && vehicleColor !== player.vehicleColor) {
              player.vehicleColor = vehicleColor;
              broadcastToRoom(state.roomId, { type: 'player_meta', playerId: player.id, vehicleColor }, ws);
            }

            // Speech is an event, not part of the 20Hz stream, so it is sent
            // once instead of riding along in every snapshot.
            const speech = clampText(msg.speechText, MAX_SPEECH_LENGTH);
            if (speech && speech !== player.speechText) {
              player.speechText = speech;
              player.speechTime = now;
              broadcastToRoom(state.roomId, { type: 'speech', playerId: player.id, text: speech }, ws);
            } else if (!speech) {
              player.speechText = undefined;
            }

            // The snapshot tick picks this up. Updates are no longer echoed
            // one-to-one, which made every client receive N x 22 messages a
            // second in an N-player room.
            room.dirty.add(player.id);
            break;
          }

          case 'object_destroyed': {
            if (!state.playerId) return;
            const room = rooms.get(state.roomId);
            if (!room) return;

            const objectId = clampText(msg.objectId, 64);
            // The map is deterministic, so an id that is not in it never came
            // from a real prop and would sit in room state until it respawned.
            if (!objectId || !knownDestructibleIds.has(objectId)) return;
            if (room.destructiblesState[objectId]?.destroyed) return;

            room.destructiblesState[objectId] = { destroyed: true, respawnAt: Date.now() + 45000 };
            broadcastToRoom(state.roomId, {
              type: 'object_destroyed',
              objectId,
              destroyedBy: state.playerId,
            });
            break;
          }

          case 'chat': {
            if (!state.playerId) return;
            const room = rooms.get(state.roomId);
            const player = room?.players.get(state.playerId);
            if (!player) return;

            const now = Date.now();
            if (now - state.chatWindowStart >= 10_000) {
              state.chatWindowStart = now;
              state.chatCount = 0;
            }
            if (++state.chatCount > MAX_CHATS_PER_10S) return;

            const text = clampText(msg.text, MAX_CHAT_LENGTH).trim();
            if (!text) return;

            // The name comes from the server's own player record, so a client
            // cannot speak under someone else's name.
            broadcastToRoom(state.roomId, {
              type: 'chat',
              playerId: player.id,
              name: player.name,
              text,
              timestamp: now,
            });
            break;
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      connections.delete(ws);
      removePlayer(ws, state.roomId, state.playerId);
    });
  });

  function removePlayer(ws: WebSocket, roomId: string, playerId: string) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.sockets.delete(ws);
    if (!playerId || !room.players.has(playerId)) return;

    room.players.delete(playerId);
    room.dirty.delete(playerId);
    broadcastToRoom(roomId, { type: 'player_left', playerId });

    if (room.players.size === 0 && room.sockets.size === 0 && roomId !== 'default') {
      rooms.delete(roomId);
    }
  }

  function broadcastToRoom(roomId: string, data: object, excludeWs?: WebSocket) {
    const room = rooms.get(roomId);
    if (!room) return;
    const payload = JSON.stringify(data);
    room.sockets.forEach((client) => {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  // Snapshot tick. Each client receives one message per tick no matter how many
  // players share the room, and it carries only what changes while driving:
  // name, vehicle type and colour are sent on join and on change.
  setInterval(() => {
    const sentAt = Date.now();
    for (const [, room] of rooms) {
      if (room.dirty.size === 0 || room.sockets.size === 0) continue;

      const players = [];
      for (const playerId of room.dirty) {
        const player = room.players.get(playerId);
        if (!player) continue;
        players.push({
          id: player.id,
          // The world is 3600px across, so sub-pixel precision is just bytes.
          x: Math.round(player.x),
          y: Math.round(player.y),
          angle: Number(player.angle.toFixed(3)),
          speed: Number(player.speed.toFixed(2)),
          steering: Number(player.steering.toFixed(3)),
          inVehicle: player.inVehicle,
          condition: Math.round(player.condition),
          headlights: player.headlights,
          turnSignal: player.turnSignal,
          isHonking: player.isHonking,
          isSiren: player.isSiren,
        });
      }
      room.dirty.clear();
      if (players.length === 0) continue;

      const payload = JSON.stringify({ type: 'snapshot', t: sentAt, players });
      room.sockets.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      });
    }
  }, TICK_MS);

  // Drop half-open connections. Without this a client that loses the network
  // never fires 'close', and the room keeps broadcasting into a dead socket.
  setInterval(() => {
    for (const [ws, connectionState] of connections) {
      if (!connectionState.isAlive) {
        connections.delete(ws);
        removePlayer(ws, connectionState.roomId, connectionState.playerId);
        ws.terminate();
        continue;
      }
      connectionState.isAlive = false;
      try {
        ws.ping();
      } catch {
        // The socket is already gone; the next sweep terminates it.
      }
    }
  }, HEARTBEAT_MS);

  // Periodic cleanup of inactive players and respawning destructible props
  setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      for (const [pId, p] of room.players) {
        if (now - p.lastUpdate > PLAYER_TIMEOUT_MS) {
          room.players.delete(pId);
          room.dirty.delete(pId);
          broadcastToRoom(roomId, { type: 'player_left', playerId: pId });
        }
      }

      for (const [objId, objectState] of Object.entries(room.destructiblesState)) {
        if (objectState.destroyed && now > objectState.respawnAt) {
          delete room.destructiblesState[objId];
          broadcastToRoom(roomId, { type: 'object_respawned', objectId: objId });
        }
      }

      // A room whose players all timed out used to leak: it was only deleted
      // on a clean socket close.
      if (room.players.size === 0 && room.sockets.size === 0 && roomId !== 'default') {
        rooms.delete(roomId);
      }
    }
  }, 5000);

  const port = await listenOnAvailablePort(server, getStartPort());

  // Vite middleware in dev / static in prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: { server },
        hmr:
          process.env.DISABLE_HMR === 'true'
            ? false
            : {
                server,
                host: '127.0.0.1',
                clientPort: port,
                path: '/vite-hmr',
              },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  console.log(`KAMAZ City Simulator Server listening on port ${port}`);
  console.log(`  Local:   http://localhost:${port}/`);
  console.log(`  Network: http://127.0.0.1:${port}/`);
}

startServer();
