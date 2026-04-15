# ThirdLife

A browser-based, persistent multiplayer life simulation. Players inhabit a shared city where they can own buildings, run businesses, earn currency, and interact with other players in real time.

**Tech Stack:** TypeScript + Babylon.js + Colyseus + React + Vite (npm workspaces monorepo)

## Studio Dashboard

Live project status, plan progress, commit feed, and a Play button:
**https://susustudio.vercel.app** (password-gated — ask the owner)

The dashboard is the source of truth for what's done and what's next. It reads the master checklist at [SuSuStudio/docs/FULL-CHECKLIST.md](https://github.com/Clawfred5510/SuSuStudio/blob/main/docs/FULL-CHECKLIST.md) and mirrors of [`PLAN-*.md`](./PLAN-2026-04-15.md) in this repo.

## Getting Started

```bash
# Install all dependencies
npm install

# One-command playtest (server + client + opens browser)
npm run play
```

Or start pieces individually:

```bash
npm run dev:server   # game server on port 2567
npm run dev:client   # client on port 3000 (opens browser)
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run play` | Start server + client together and open the browser |
| `npm run dev:client` | Start client dev server |
| `npm run dev:server` | Start game server |
| `npm run build` | Build all packages |
| `npm run typecheck` | Type-check all packages |
| `npm run lint` | Lint all source files |
| `npm run format` | Format all source files |

## Project Structure

```
ThirdLife/
├── packages/
│   ├── client/          # Babylon.js + React game client
│   ├── server/          # Colyseus multiplayer server + API
│   └── shared/          # Shared types and constants
├── studio/              # Agent configs, taskboard, docs
├── docs/                # Game design, technical, and art documentation
└── assets/              # Source art assets (models, textures, audio)
```

## Documentation

- **Active plan:** [PLAN-2026-04-15.md](./PLAN-2026-04-15.md) (mirror of the SuSuStudio master checklist)
- [Game Design Document](docs/game-design/thirdlife-gdd.md)
- [Technical Architecture](docs/technical/architecture.md)
- [Asset Pipeline](docs/art/asset-pipeline.md)
- [Studio Overview](STUDIO.md)
