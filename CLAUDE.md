# GameStu — AI Game Studio

You are working inside **GameStu**, a virtual game studio powered by AI agents.

## Current Project: ThirdLife
A browser-based persistent multiplayer life simulation. Players share a city, own buildings, run businesses, and earn currency. Think GTA Online meets Second Life.

**Tech Stack:** TypeScript monorepo (npm workspaces)
- `packages/client/` — Babylon.js + React + Vite (port 3000)
- `packages/server/` — Colyseus + Express + Node (port 2567)
- `packages/shared/` — Shared types and constants
- `packages/dashboard/` — Studio management dashboard (port 3002)

**Current Phase:** Phase 1 — Multiplayer Core

## Studio Structure
- `studio/departments/` — Department configs and agent role files
- `studio/taskboard/BOARD.md` — Active task board
- `studio/shared/` — Vision, glossary, standards
- `docs/` — GDD, architecture, art pipeline

## Agent Roles
Each agent has a `role.md` file defining their responsibilities and scope. If you are acting as an agent, read your role file first and stay within your defined responsibilities.

## Code Standards
- TypeScript strict mode everywhere
- PascalCase for classes/files, camelCase for functions/variables, UPPER_SNAKE_CASE for constants
- Named imports preferred
- Server is authoritative for game state
- All code must pass `npm run typecheck` and `npm run lint`

## Before Committing
Run `npm run typecheck` and `npm run build` to verify nothing is broken.
