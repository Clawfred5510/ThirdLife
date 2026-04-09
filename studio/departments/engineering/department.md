# Engineering Department

## Mission
Build and maintain the technical foundation of all studio projects.

## Pipeline
1. **Spec** — Tech Lead writes technical spec from design brief
2. **Implement** — Engineers write code
3. **Review** — Tech Lead reviews code
4. **Integrate** — Merge to main, verify CI passes

## Roles
- **Tech Lead** (Always Active) — Architecture, code review, delegation
- **Network Engineer** (Active P1) — Multiplayer, Colyseus, netcode
- **Gameplay Engineer** (Standby) — Player systems, economy code, game logic
- **Tools Engineer** (On-Demand) — Build pipeline, CI/CD, dev tooling

## Tech Stack
- TypeScript (strict mode)
- Babylon.js (client rendering)
- Colyseus (multiplayer server)
- Vite (client bundling)
- Node.js + Express (server HTTP)

## Standards
- All code must pass typecheck and lint before merge
- Functions should be small and focused
- State synchronization is server-authoritative
