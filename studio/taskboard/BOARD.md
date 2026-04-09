# Taskboard

## Phase 1 — Multiplayer Core

### In Progress
- None

### Backlog
(ALL PHASES COMPLETE — v1 prototype ready)

### Done
- [x] Project scaffolding and monorepo setup
- [x] Babylon.js scene with ground and camera
- [x] Colyseus server with GameRoom
- [x] Shared types and constants package
- [x] Studio dashboard (port 3002) with agents, tasks, project, health tabs
- [x] TASK-001: Player movement with WASD/arrow keyboard input
- [x] TASK-002: Player position sync (server-authoritative, delta-time, input buffering)
- [x] TASK-003: Remote player mesh rendering with lerp interpolation
- [x] TASK-004: Chat system with React UI, sender names, message sanitization
- [x] TASK-005: Player connect/disconnect toasts, HUD player count + connection status
- [x] TASK-006: Server-side input validation, world bounds clamping (-1000 to 1000)
- [x] TASK-008: Ground collision (Y clamp) + ground expanded to 2000x2000
- [x] TASK-010: Player rotation sync (optional in input, server applies)
- [x] TASK-011: Player name labels (billboard GUI text above meshes)
- [x] Economy design document (currency, jobs, property market, anti-exploit)
- [x] City layout design — Haven Point (5 districts, ~605 plots, spawn at City Hall)
- [x] TASK-007: Client-side prediction (instant local movement, snap correction >2 units)
- [x] TASK-009: Input throttling (20Hz match, 66% bandwidth reduction)
- [x] QA audit: Fixed double schema registration, Color4 type fix
- [x] City terrain: 5 district grounds, roads, river, bay, spawn at City Hall
- [x] Buildings: 9 landmarks + 60 purchasable plots (12 per district)
- [x] Day/night cycle: 10-min sun rotation, sky color transitions, light intensity
- [x] Minimap: Canvas-based 150px map with district colors and player dots
- [x] Wired buildings + day/night into MainScene
- [x] SQLite database with players + properties tables, WAL mode
- [x] Player persistence (save position on leave, restore on join)
- [x] Credits in PlayerState, synced to client
- [x] Property purchase handler (server validates, deducts credits, broadcasts)
- [x] Wallet UI (credits display in HUD)
- [x] PropertyPanel UI (E to interact, buy button, ownership display)
- [x] Economy message types (BUY_PROPERTY, CREDITS_UPDATE, PROPERTY_UPDATE)
- [x] Jobs design doc (4 starter jobs with payout formulas)
- [x] Tutorial design doc (5-minute guided flow, ends at 775 CR)
- [x] Settings menu (Escape key toggle, character color picker, volume, cycle speed)
- [x] GameMenu container with Escape key management
- [x] PLAYER_COLOR message type + sendPlayerColor + getPlayerName
- [x] DayNightCycle.setCycleDuration() for runtime speed changes
- [x] getDayNightCycle() exported from MainScene for UI access
- [x] QA: Fixed movement direction mismatch (CRITICAL)
- [x] QA: Fixed day/night running 1000x too fast (CRITICAL)
- [x] QA: Fixed PropertyPanel wrong propertyId mapping (MAJOR)
- [x] QA: Fixed Wallet never showing initial credits (MAJOR)
- [x] QA: Fixed network listener memory leak — all on* return unsubscribe (MAJOR)
- [x] Seeded 60 purchasable properties into DB on server start
