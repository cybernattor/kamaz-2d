import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

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
  destructiblesState: Record<string, { destroyed: boolean; respawnAt: number }>;
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
      destructiblesState: {},
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
  const socketRooms = new WeakMap<WebSocket, string>();
  wss.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') {
      console.error('WebSocket server error:', error);
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let playerId = '';
    let currentRoomId = 'default';

    ws.on('message', (messageRaw: string) => {
      try {
        const msg = JSON.parse(messageRaw.toString());

        switch (msg.type) {
          case 'join': {
            playerId = msg.playerId || `player_${Math.random().toString(36).substring(2, 8)}`;
            currentRoomId = msg.roomId || 'default';
            const room = getOrCreateRoom(currentRoomId, msg.roomName);
            socketRooms.set(ws, currentRoomId);

            const initialPlayer: PlayerState = {
              id: playerId,
              name: msg.name || 'Дальнобойщик',
              room: currentRoomId,
              x: msg.x ?? 1200,
              y: msg.y ?? 1200,
              angle: msg.angle ?? 0,
              speed: 0,
              steering: 0,
              inVehicle: msg.inVehicle ?? true,
              vehicleType: msg.vehicleType || 'kamaz_dump',
              vehicleColor: msg.vehicleColor || '#f97316',
              condition: 100,
              headlights: 1,
              turnSignal: 'none',
              isHonking: false,
              isSiren: false,
              lastUpdate: Date.now(),
            };

            room.players.set(playerId, initialPlayer);

            // Send init response with current room players and destructibles
            ws.send(
              JSON.stringify({
                type: 'init',
                yourId: playerId,
                players: Array.from(room.players.values()),
                destructibles: room.destructiblesState,
              })
            );

            // Broadcast to other players in room
            broadcastToRoom(
              currentRoomId,
              {
                type: 'player_joined',
                player: initialPlayer,
              },
              ws
            );
            break;
          }

          case 'update': {
            if (!playerId || !currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            const player = room.players.get(playerId);
            if (player) {
              Object.assign(player, {
                x: msg.x,
                y: msg.y,
                angle: msg.angle,
                speed: msg.speed,
                steering: msg.steering,
                inVehicle: msg.inVehicle,
                vehicleType: msg.vehicleType,
                vehicleColor: msg.vehicleColor,
                condition: msg.condition,
                headlights: msg.headlights,
                turnSignal: msg.turnSignal,
                isHonking: msg.isHonking,
                isSiren: msg.isSiren,
                speechText: msg.speechText,
                speechTime: msg.speechText ? Date.now() : undefined,
                lastUpdate: Date.now(),
              });

              // Broadcast update delta to room
              broadcastToRoom(
                currentRoomId,
                {
                  type: 'player_updated',
                  player,
                },
                ws
              );
            }
            break;
          }

          case 'object_destroyed': {
            if (!currentRoomId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            if (msg.objectId) {
              room.destructiblesState[msg.objectId] = {
                destroyed: true,
                respawnAt: Date.now() + 45000,
              };

              broadcastToRoom(
                currentRoomId,
                {
                  type: 'object_destroyed',
                  objectId: msg.objectId,
                  destroyedBy: playerId,
                }
              );
            }
            break;
          }

          case 'chat': {
            if (!currentRoomId) return;
            broadcastToRoom(
              currentRoomId,
              {
                type: 'chat',
                playerId,
                name: msg.name,
                text: msg.text,
                timestamp: Date.now(),
              }
            );
            break;
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      if (playerId && currentRoomId && rooms.has(currentRoomId)) {
        const room = rooms.get(currentRoomId)!;
        room.players.delete(playerId);

        broadcastToRoom(currentRoomId, {
          type: 'player_left',
          playerId,
        });

        socketRooms.delete(ws);

        if (room.players.size === 0 && currentRoomId !== 'default') {
          rooms.delete(currentRoomId);
        }
      }
    });
  });

  function broadcastToRoom(roomId: string, data: object, excludeWs?: WebSocket) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (
        client !== excludeWs &&
        client.readyState === WebSocket.OPEN &&
        socketRooms.get(client) === roomId
      ) {
        client.send(payload);
      }
    });
  }

  // Periodic cleanup of inactive players and respawning destructible props
  setInterval(() => {
    const now = Date.now();
    for (const [, room] of rooms) {
      for (const [pId, p] of room.players) {
        if (now - p.lastUpdate > 30000) {
          room.players.delete(pId);
          broadcastToRoom(room.id, { type: 'player_left', playerId: pId });
        }
      }

      for (const [objId, state] of Object.entries(room.destructiblesState)) {
        if (state.destroyed && now > state.respawnAt) {
          delete room.destructiblesState[objId];
          broadcastToRoom(room.id, { type: 'object_respawned', objectId: objId });
        }
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
