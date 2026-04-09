# Technical Architecture

## Stack Overview

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Client Rendering | Babylon.js | 3D scene, physics, animation |
| Client UI | React | HUD, menus, overlays |
| Client Build | Vite | Dev server, bundling |
| Networking | Colyseus.js | Real-time multiplayer state sync |
| Server | Node.js + Express | Game server, HTTP endpoints |
| Shared | TypeScript | Types, constants, schemas |
| Language | TypeScript | Entire stack |

## Monorepo Structure
Uses npm workspaces with three packages:
- `packages/client` — Browser game client
- `packages/server` — Colyseus game server
- `packages/shared` — Shared types and constants

## Client Architecture
```
main.ts → Game.ts → MainScene.ts
                  → systems/ (ECS game logic)
                  → entities/ (game object factories)
       → App.tsx → HUD.tsx (React overlay)
       → Client.ts (Colyseus connection)
```

## Server Architecture
```
index.ts → Express HTTP + Colyseus Server
         → GameRoom.ts (room logic, message handling)
         → GameState.ts (Colyseus schema, state sync)
```

## State Synchronization
- Colyseus handles automatic state delta sync
- Server is authoritative for player positions
- Client sends inputs, server processes and broadcasts state
- Tick rate: 20 Hz server-side simulation

## Future Considerations
- Database (PostgreSQL) for persistent world state
- Redis for session management and caching
- CDN for static assets
- Horizontal scaling with Colyseus presence (Redis)
