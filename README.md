# KAMAZ City Simulator 2D

2D top-down driving sandbox with KAMAZ trucks, traffic, pedestrians, missions,
destructible environments and multiplayer.

Repository: https://github.com/cybernattor/kamaz-2d

## Run Locally

**Prerequisites:** Node.js 22+

1. Install dependencies: `npm install`
2. Start the development server: `npm run dev`

The server listens on the port configured by `PORT` (default: `3000`, and it
moves to the next free port if that one is busy). Vite runs inside the same
server, so the game and the multiplayer WebSocket (`/ws`) share one origin.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Game + multiplayer server with hot reload |
| `npm run build` | Builds the client (`dist/`) and bundles the server (`dist/server.cjs`) |
| `npm start` | Runs the production build (`NODE_ENV=production`) |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm test` | Runs every `repros/*.repro.ts` scenario; `npm test -- traffic` filters by name |

Each repro is a small deterministic script that exits non-zero on failure and
is named after the behaviour it protects (traffic, physics, map, multiplayer,
pedestrians, server).

## Multiplayer

Players join a room over WebSocket. The server assigns ids, clamps every field
it receives, rate-limits updates and chat, caps room/player counts, and drops
oversized messages, cross-origin handshakes and idle players. Positions are
still reported by clients, so this is a casual co-op server, not an
anti-cheat one. `GET /api/health` and `GET /api/rooms` expose room status.

## Deployment

`render.yaml` describes a free Render web service. The build installs
dev dependencies too (`npm ci --include=dev`) because the build needs Vite,
Tailwind, esbuild and TypeScript.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
