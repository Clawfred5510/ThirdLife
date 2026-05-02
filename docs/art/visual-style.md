# ThirdLife Visual Style — "Cozy Diorama Tycoon"

Last updated: 2026-05-01.
Reference assets: `gamedesigns/` (apartment, bank, factory, farm, hall, house, mine, office, powerplant, store).

---

## One-line direction

**Hand-painted isometric diorama dollhouse.** Each building reads as a self-contained, lovingly detailed miniature — like a Two Point Hospital, Township, or Cozy Grove tile. No flat polygon look, no neon, no MS-Paint primitives.

The world feels small, walkable, warm, and inhabited. Every surface tells a tiny story (a bench, a sandwich-board, a stack of crates, a lamppost) — never a bare cube.

---

## Camera + composition

- **Reference angle:** ~30° pitch, ~45° yaw — the classic SimCity BuildIt three-quarter view.
- **Subject framing:** Each building occupies its own raised "plinth" — a tan/grey rounded rectangle base with sidewalk + a strip of greenery. The plinth is part of the building.
- **Scale:** Buildings read at ~600px square reference; in-world they should occupy roughly one parcel (40u × 40u) including their plinth.
- **Background:** Soft neutral. The world ground is muted enough that buildings pop without competing.

## Color palette (pulled from reference assets)

| Role | Hex | Where it shows |
|------|------|-----------------|
| Brick terra cotta | `#B5563A` | Apartment, factory walls, hall accents |
| Warm ochre | `#E8A93D` / `#D89438` | House clapboard, factory accent, store base |
| Forest green | `#3F7A3D` | Awnings, trim, farm roof, store accent |
| Deep teal | `#2A5560` | Glass tinting, office curtain wall |
| Slate navy | `#2E3F58` | House roof, parapets, dark trim |
| Sandstone | `#D8C4A0` | Bank/hall masonry, sidewalks |
| Concrete grey | `#B5B0A8` / `#7A7E88` | Plinth, plaza, industrial walls |
| Foliage | `#3F8B3A` (round) / `#2A5A30` (cone) | Trees, bushes, planters |
| Wood brown | `#7A4F2E` (warm) / `#5A3A22` (dark) | Mine timber, farm planks, fence rails |

**Avoid:** pure black, pure white, neon saturation. Everything is slightly desaturated and warm-biased.

## Material rules

1. **Brick** = visible mortar lines. Slight horizontal banding in the texture.
2. **Wood** = grain visible on planks; corners darkened.
3. **Stone / sandstone** = blocky coursing, soft ambient occlusion in the seams.
4. **Glass** = deep teal tint with a single soft highlight, never a full chrome reflection.
5. **Metal** = matte painted iron (lampposts, fences, AC units), not chrome. Subtle high-end highlight only.
6. **Foliage** = hand-painted blob shapes — round puffs or cones, with a dark-side gradient. No flat green planes.

## Lighting

- Key: warm directional, ~upper-left, soft falloff.
- Ambient: warm tan fill — keeps shadow side from going black.
- Subtle rim: thin warm edge on tall elements (chimneys, towers).
- Cast shadows are small, soft, and short — diorama depth, not realism.

## Detail density (the key rule)

Every building must include **at least 4 of these props** at its plinth:
- Tree (round-puff or cone)
- Bush / hedge
- Lamppost
- Bench
- Mailbox / signboard
- Planter or window box
- Awning over the entrance
- Rooftop AC unit, water tower, or chimney
- Stairs or ramp at the door
- Fence segment

This is what stops the world from feeling MS-Paint. The base mesh is the easy part; the bric-a-brac is the style.

## Per-building signatures (preserve these distinctly)

| Building | Signature props |
|----------|-----------------|
| Apartment | 2-storey brick, green awning, brown chimney, rooftop AC, mailbox cluster, 2 trees, sidewalk bench |
| House | Yellow clapboard, slate gable + chimney, white porch posts, picket fence, mailbox, front-yard tree |
| Shop / Store | Yellow walls + green trim + red-stripe awning, glass front, lamppost, shopping cart, fruit-crate, sandwich-board |
| Farm | Red barn + green gambrel roof, paired silos, planter rows, wood fence, water-pump well |
| Office | Beige stone + teal glass, navy entry awning, planter boxes, side tree |
| Hall | Neoclassical pediment, columns, "HALL" inscription, two flagpoles, sign post, hedge row |
| Bank | Pediment + columns + "BANK" sign, brass lamps, brass-balled stair posts, plaque sign |
| Factory | Brick walls, sawtooth roof, 3 chimneys, "FACTORY" sign, garage roll-door, crates, fence, propane tank |
| Power plant | Yellow walls + green trim, 3 striped chimneys, AC units, large silo, "COAL POWER PLANT" sign |
| Mine | Wooden pithead headframe with winch, stone+timber entrance, ore cart on rails, rock outcrops, lantern |

## UI tone

The 3D world sets the rules — UI follows.
- **Backgrounds:** warm dark tan (`#1A1410`–`#2A1F18`) instead of cold neon-black.
- **Accents:** ochre, forest green, terra cotta — not cyan / magenta / electric blue.
- **Type:** clean sans for stats, with a warm soft-serif option for headers (e.g. `Lora`, `Source Serif`, `Merriweather`).
- **Buttons:** rounded but not pill-shaped; subtle inner shadow gives them physicality. No pure-flat material buttons.
- **Emoji:** kept for navigation icons but tone down quantity in body text. Headers stay lowercase to feel friendly.
- **Glow / neon outlines:** not used. Everything has weight.

## Implementation strategy

The target is **true 3D meshes** in the cozy-diorama style — generated through Meshy.AI (or an equivalent text/image-to-3D tool) using the `gamedesigns/` reference renders as the visual brief.

Workflow:
1. Use each `gamedesigns/<type>.png` as the input image for Meshy.AI's image-to-3D mode.
2. Export the resulting mesh as `.glb` (PBR textures baked in).
3. Drop the file under `packages/client/public/assets/models/<type>.glb`.
4. Wire it into the building dispatcher via `SceneLoader.ImportMeshAsync` — one entry per type.
5. Keep the bespoke procedural meshes that already exist as the fallback while individual types are converted; replace one at a time.

A flat-image billboard fallback was tried briefly and abandoned — the quads orient awkwardly under Babylon's Y-billboard mode and the result feels like a pasted poster rather than a building. Stay 3D.

Until the .glb assets land, the existing per-type procedural meshes (apartment.ts, bank.ts, factory.ts, ...) remain the source of truth. They should be incrementally improved toward the diorama palette + detail-density rule above as a stopgap.

## Anti-goals

- No flat-shaded boxes with single colors.
- No high-tech neon "city of the future" lighting.
- No grayscale realism. The world is meant to feel like a children's book.
- No "Polygon Town" Roblox-Lego look. We want painted, not blocky.
