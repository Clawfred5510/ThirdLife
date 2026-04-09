# ThirdLife — Game Design Document

## Overview
**ThirdLife** is a persistent, multiplayer open-world life simulation. Players inhabit a shared city where they can own buildings, run businesses, earn in-game currency, and interact with other players in real time.

**Genre:** Life Simulation / Open World / Multiplayer
**Platform:** Web (browser-based)
**Engine:** Babylon.js (client) + Colyseus (server)
**Inspiration:** GTA Online, Second Life, Sunday City

## Core Pillars
1. **Ownership** — Players can purchase, customize, and profit from buildings and businesses
2. **Economy** — A player-driven economy with jobs, trade, and property value
3. **Social** — Real-time multiplayer interaction, chat, and collaboration
4. **Persistence** — The world persists and evolves whether you're online or not

## Core Gameplay Loop
1. Enter the city as a new resident
2. Earn money through jobs or activities
3. Purchase property (apartments, shops, venues)
4. Customize and operate your property
5. Earn passive income from your businesses
6. Expand your empire / upgrade / trade

## World Design
- A single persistent city divided into **districts**
- Districts: Downtown, Residential, Industrial, Waterfront, Entertainment
- Each district has different property types and price ranges
- The city grows and evolves based on collective player activity

## Economy System
- **Currency:** Credits (earned, not purchased with real money initially)
- **Income sources:** Jobs, business revenue, trading, missions
- **Expenses:** Rent, maintenance, upgrades, customization
- **Property market:** Dynamic pricing based on supply/demand and location

## Player Systems
- Character customization (appearance, clothing)
- Inventory system for items and furniture
- Reputation/level system tied to activities
- Social features: friends list, chat, emotes

## Technical Requirements
- Support 50+ concurrent players per server instance
- Sub-100ms state sync for player movement
- Persistent world state backed by database
- Instanced interiors for owned buildings

## Milestones

### Phase 1 — Multiplayer Core
- [ ] Server with player join/leave/move
- [ ] Client with 3D scene and camera
- [ ] Real-time player position sync
- [ ] Basic chat system

### Phase 2 — World Foundation
- [ ] City ground layout with districts
- [ ] Basic building meshes (placeholders)
- [ ] Player movement with collision
- [ ] Day/night cycle

### Phase 3 — Ownership & Economy
- [ ] Property purchase system
- [ ] Basic business types (shop, apartment)
- [ ] Currency earning and spending
- [ ] Persistent player data

### Phase 4 — Polish & Content
- [ ] Character customization
- [ ] Building interiors
- [ ] NPC systems
- [ ] Missions/activities
- [ ] Audio and music
