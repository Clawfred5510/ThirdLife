# ThirdLife Game — Full Context Handoff

## Project Overview
ThirdLife is a 3D virtual world game (similar to SecondLife conceptually) built for the game studio "SuSuStudio." The game is set in a city called "Haven Point" with 5 districts: Downtown, Residential, Industrial, Waterfront, and Entertainment.

## Repository
- **GitHub**: `Clawfred5510/ThirdLife` (NOT under SuSuStudio org)
- **Branch**: `main`

## Tech Stack
- **3D Engine**: Babylon.js 7
- **Multiplayer**: Colyseus v0.15.14 (WebSocket-based room server)
- **Client UI**: React 18 + Vite 5
- **Server**: Node.js + Express + Colyseus + better-sqlite3
- **Shared Types**: TypeScript package consumed by both client and server
- **Dashboard**: Next.js (separate package, lower priority)
- **Monorepo**: npm workspaces with packages: `client`, `server`, `shared`, `dashboard`

## Project Structure
```
ThirdLife/
├── packages/
│   ├── client/          # React + Vite + Babylon.js game client
│   │   ├── src/
│   │   │   ├── game/
│   │   │   │   ├── Game.ts              # Main game class, connects to server, offline fallback
│   │   │   │   ├── scenes/MainScene.ts  # 3D scene: terrain, buildings, NPCs, day/night, player management
│   │   │   │   ├── entities/buildings.ts # Landmark + procedural building generation
│   │   │   │   ├── entities/npcs.ts     # Static NPC spawning with labels
│   │   │   │   ├── systems/dayNight.ts  # Day/night cycle with sky color transitions
│   │   │   │   ├── components/index.ts  # ECS component stubs (empty)
│   │   │   │   └── systems/index.ts     # ECS system stubs (empty)
│   │   │   ├── network/Client.ts        # Colyseus client wrapper, event listeners
│   │   │   ├── ui/App.tsx               # React UI root
│   │   │   ├── ui/components/           # HUD, ChatPanel, Minimap, Wallet, PropertyPanel, etc.
│   │   │   └── main.ts                  # Entry point: init Babylon + React
│   │   ├── postcss.config.js            # Empty PostCSS config (prevents parent project leak)
│   │   ├── vite.config.ts               # Vite config with shared source alias
│   │   └── package.json
│   ├── server/          # Colyseus multiplayer server
│   │   ├── src/
│   │   │   ├── rooms/GameRoom.ts    # Colyseus room: game state, player join/leave, jobs
│   │   │   ├── state/GameState.ts   # Schema definitions with @colyseus/schema
│   │   │   ├── standalone.ts        # Standalone server (Express + Colyseus + static files)
│   │   │   ├── db/index.ts          # SQLite database for persistence
│   │   │   ├── systems/jobs.ts      # Job system logic
│   │   │   ├── systems/tutorial.ts  # Tutorial system
│   │   │   └── api/studio.ts        # Studio API routes
│   │   └── package.json
│   ├── shared/          # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── index.ts       # Re-exports types and constants
│   │   │   ├── types.ts       # Vec3, PlayerInput, ChatMessage, MessageType enum
│   │   │   └── constants.ts   # TICK_RATE, PLAYER_SPEED, WORLD_SIZE, BUS_STOPS, etc.
│   │   ├── tsconfig.json      # CommonJS output with declarations
│   │   └── package.json
│   └── dashboard/       # Next.js dashboard (lower priority, not actively worked on)
├── package.json         # Root: npm workspaces, sequential build scripts
├── tsconfig.base.json
└── start.sh
```

## Key Architecture Decisions

### Shared Package Resolution
- Shared package compiles to CommonJS with `.d.ts` declarations
- Client uses a **Vite resolve alias** (`@gamestu/shared` → `../shared/src/index.ts`) to import shared SOURCE directly, bypassing the dist
- Server imports the compiled CommonJS output from `@gamestu/shared`
- Client `package.json` has `"type": "module"`, so PostCSS config uses ESM `export default` syntax

### Build Order
The root `npm run build` runs sequentially: `shared → client → server`
- `build:shared`: `tsc` → produces `dist/*.js` + `dist/*.d.ts`
- `build:client`: `vite build` (no `tsc` step — Vite handles TypeScript compilation)
- `build:server`: `tsc` → produces `dist/*.js`

### Offline Mode
When the Colyseus server is unavailable:
1. `Game.ts` catches the connection error and calls `_offlinePlayerSpawn(localId)`
2. `MainScene` stores the offline player ID in `this.localPlayerId`
3. `applyLocalPrediction()` uses `getSessionId() ?? this.localPlayerId` to find the local player
4. `interpolateRemotePlayers()` skips the local player (they're handled by local prediction)
5. `sendPlayerInput()` silently does nothing (null-safe `room?.send()`)

### Follow Camera
- Game starts with an `ArcRotateCamera` (free orbit)
- When the local player spawns (online or offline), it switches to a `FollowCamera`
- FollowCamera tracks the player capsule mesh with configurable radius, height offset, and rotation
- Keyboard move input is removed from the camera to prevent conflicts with WASD movement

## Bugs Fixed (2026-04-15)

### Critical: Offline Movement Was Broken
**Problem**: `applyLocalPrediction()` used `getSessionId()` which returns `null` without a Colyseus room. The function exited immediately — keyboard input never moved the player.

**Fix**: Added `localPlayerId` field to `MainScene`. Set it in both offline spawn and online `onPlayerAdd`. `applyLocalPrediction()` now uses `getSessionId() ?? this.localPlayerId`.

### Critical: Offline Player Pulled Back to Origin
**Problem**: `interpolateRemotePlayers()` lerped ALL players (including local) toward their target position. The offline player's target was always (0,0,0) since no server updated it.

**Fix**: `interpolateRemotePlayers()` now skips the local player with `if (sessionId === localId) return;`.

### Build: PostCSS Config Leak
**Problem**: Parent project's `/postcss.config.mjs` (with `@tailwindcss/postcss`) was found by Vite when building the ThirdLife client. This plugin isn't installed in ThirdLife's node_modules.

**Fix**: Added empty `postcss.config.js` (ESM syntax) to `packages/client/` to block upward search.

### Build: No Shared-First Ordering
**Problem**: `npm run build --workspaces` didn't guarantee shared built before client/server.

**Fix**: Changed root build script to sequential: `npm run build:shared && npm run build:client && npm run build:server`.

### Build: Client tsc Step Fragile
**Problem**: Client `build` script was `tsc && vite build`. The `tsc` step required shared `.d.ts` files and was redundant since Vite handles TypeScript.

**Fix**: Changed client build to just `vite build`. Type-checking is available separately via `npm run typecheck`.

## How to Run Locally
```bash
git clone https://github.com/Clawfred5510/ThirdLife.git
cd ThirdLife
npm install
npm run build        # builds shared → client → server
npm run standalone   # starts Express + Colyseus + serves client on :8080
# Open http://localhost:8080
```

## How to Run Client Only (Dev Mode)
```bash
cd ThirdLife
npm run dev:client   # starts Vite dev server on :3000
# Open http://localhost:3000 — works in offline mode
```

## Current Game Features
### Working Offline (no server needed)
- 3D world exploration (Haven Point city with 5 districts)
- WASD/Arrow key movement with third-person follow camera
- Buildings (9 landmarks + 60 purchasable plots)
- NPCs (job boards, guards, shopkeepers) with floating labels
- Day/night cycle (10-minute rotation)
- Roads, river, and bay water features

### Requires Multiplayer Server
- Chat system
- Property buying/selling
- Jobs/credits economy
- Seeing other players
- Fast travel bus stops

## What Still Needs Work
1. **Server hardening** — `better-sqlite3` requires native compilation; should fallback to in-memory
2. **Multiplayer testing** — Server runs but hasn't been tested with multiple clients
3. **Dashboard** — Next.js dashboard package exists but hasn't been actively developed
4. **Game polish** — Textures are basic colors, no animations, minimal UI
5. **Mobile support** — No touch controls
6. **Deployment** — No public deployment yet
7. **Collision detection** — Player can walk through buildings
8. **SuSuStudio GitHub org** — Doesn't exist yet, repo is under personal account

## User's Priorities
- "I need it to work and be a fully playable game"
- "I want you to build out the 3D game we were working on"
- "I still do not have a playable version"
- "I dont want it connected yet" (regarding dashboard)
- All work should be pushed to GitHub
