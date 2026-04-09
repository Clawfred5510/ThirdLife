# GameStu

Virtual Game Studio — home of **ThirdLife** and future projects.

## ThirdLife

A browser-based, persistent multiplayer life simulation. Players inhabit a shared city where they can own buildings, run businesses, earn currency, and interact with other players in real time.

**Tech Stack:** TypeScript + Babylon.js + Colyseus + React + Vite

## Getting Started

```bash
# Install all dependencies
npm install

# Start the game server (port 2567)
npm run dev:server

# Start the client dev server (port 3000, opens browser)
npm run dev:client

# Start the studio dashboard (port 3002, opens browser)
npm run dev:dashboard
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:client` | Start client dev server |
| `npm run dev:server` | Start game server |
| `npm run dev:dashboard` | Start studio dashboard |
| `npm run build` | Build all packages |
| `npm run typecheck` | Type-check all packages |
| `npm run lint` | Lint all source files |
| `npm run format` | Format all source files |

## Project Structure

```
GameStu/
├── packages/
│   ├── client/          # Babylon.js + React game client
│   ├── server/          # Colyseus multiplayer server + API
│   ├── dashboard/       # Studio management dashboard
│   └── shared/          # Shared types and constants
├── studio/              # Studio infrastructure (agents, taskboard, docs)
├── docs/                # Game design, technical, and art documentation
└── assets/              # Source art assets (models, textures, audio)
```

## Documentation

- [Game Design Document](docs/game-design/thirdlife-gdd.md)
- [Technical Architecture](docs/technical/architecture.md)
- [Asset Pipeline](docs/art/asset-pipeline.md)
- [Studio Overview](STUDIO.md)
