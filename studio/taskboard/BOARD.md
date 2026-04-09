# Taskboard

## Phase 1 — Multiplayer Core

### In Progress
- None

### Backlog
(Phase 1 & 2 COMPLETE — moving to Phase 3: Economy & Persistence)

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
