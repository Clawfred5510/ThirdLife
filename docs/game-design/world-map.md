# ThirdLife — World Map & District Design

## 1. City Overview

The city of **Haven Point** occupies a 2000x2000 unit space. The coordinate system places (0, 0) at the southwest corner and (2000, 2000) at the northeast corner.

### Shape and Geography

The city is roughly circular in its developed area, with a coastline running along the entire southern and southeastern edge (a bay). The northwest quadrant rises in elevation slightly (a gentle hill). A river enters from the west at approximately y=1000, curves south, and empties into the bay at roughly (1200, 0). This river is the primary natural landmark and separates the western districts from the eastern ones.

```
N (y=2000)
    +--------------------------------------------------+
    |                                                  |
    |      RESIDENTIAL           INDUSTRIAL            |
    |      (NW quadrant)         (NE quadrant)         |
    |                                                  |
    |           ~~~~~~~~~                              |
    |            River  ~~~                             |
    |                     ~~                            |
    |      ENTERTAINMENT    ~~   DOWNTOWN              |
    |      (W-center)        ~   (E-center)            |
    |                        ~~                        |
    |                         ~~                       |
    |                          ~                       |
    |  ~~~~~~~~~~~~~~~~~~~~~~~~~ WATERFRONT            |
    |  ~~~~~~~~~~~~~ BAY ~~~~~~~~(SE quadrant)         |
    +--------------------------------------------------+
S (y=0)                                           E (x=2000)
W (x=0)
```

### Major Roads

Four primary roads form the backbone of the city:

- **Haven Boulevard** (east-west) — Runs from (0, 1000) to (2000, 1000). The main artery. Crosses the river via the Grand Bridge.
- **Central Avenue** (north-south) — Runs from (1000, 0) to (1000, 2000). Intersects Haven Blvd at the city's exact center.
- **Bayshore Drive** (curved, south edge) — Follows the coastline from (0, 200) curving along the bay to (1800, 200). Scenic route.
- **Ring Road** (partial loop) — A semicircular road connecting the northern districts at roughly r=800 from city center, running from the west to the east side.

Roads are 30 units wide (sidewalks included). Intersections are roughly 40x40 units.

### Transportation

- **Walking** — Primary mode. 5 units/second.
- **Bus Stops** — Placed at major intersections. Using a bus teleports the player to another stop after a short wait (5 seconds). One bus stop per district minimum.
- **River Ferry** — Two docks (Entertainment side and Downtown side) for crossing the river. Functions like a bus stop on water.
- **Taxi Spawn Points** — Scattered. Taxis let players set a destination and auto-walk at 2x speed (10 units/sec).

---

## 2. District Map

### Boundaries

| District | Approx. Bounds (x, y) | Size | Center Point |
|---|---|---|---|
| Downtown | (1100, 400) to (1800, 1100) | 700 x 700 | (1450, 750) |
| Residential | (100, 1100) to (900, 1900) | 800 x 800 | (500, 1500) |
| Industrial | (1100, 1200) to (1900, 1900) | 800 x 700 | (1500, 1550) |
| Waterfront | (1200, 0) to (2000, 500) | 800 x 500 | (1600, 250) |
| Entertainment | (100, 400) to (900, 1100) | 800 x 700 | (500, 750) |

The remaining space is occupied by: the river corridor (~100 units wide), the bay (south of y=200 on the west side), parkland buffers between districts (~50-100 units), and road infrastructure.

### Connections

- **Downtown <-> Entertainment:** Grand Bridge over the river at Haven Blvd (y~1000). The most traveled connection.
- **Downtown <-> Waterfront:** Central Avenue heading south from Downtown into the Waterfront.
- **Downtown <-> Industrial:** Central Avenue heading north, or Ring Road.
- **Residential <-> Entertainment:** Direct road connection along the western side. Ring Road also connects them.
- **Residential <-> Industrial:** Ring Road across the top of the city.
- **Entertainment <-> Waterfront:** Bayshore Drive along the southern coast, crossing the river mouth via a low bridge.

Every district is reachable from every other district in at most two road connections (no dead ends).

---

## 3. District Details

### 3.1 Downtown

**Theme:** The commercial heart. Glass towers, wide sidewalks, busy plazas. Modern and polished. Dominant colors: steel blue, white, glass reflections. Street-level shops under tall office buildings.

**Visual Identity:** Tall buildings (8-20 stories visually), clean streets, digital billboards, fountains, benches. The most "urban" feel.

**Property Types:**
| Type | Plot Size | Price Range | Approx. Plots |
|---|---|---|---|
| Office Building | 40x40 | 8,000 - 25,000 Cr | 30 |
| Retail Shop (ground floor) | 20x20 | 3,000 - 10,000 Cr | 60 |
| Luxury Apartment | 20x20 | 5,000 - 15,000 Cr | 40 |
| Restaurant / Cafe | 20x30 | 4,000 - 12,000 Cr | 25 |

**Key Landmarks:**
- **City Hall** (1400, 800) — Non-purchasable. Central plaza, mission board, government services. The civic anchor.
- **Grand Bridge** (1100, 1000) — The river crossing. Iconic visual.
- **Haven Tower** (1500, 700) — The tallest building. Observation deck with city overview. Non-purchasable landmark.
- **Central Market** (1350, 600) — Open-air market area where players can set up temporary stalls.

**NPC Density:** High. Office workers, shoppers, business NPCs, taxi drivers. 15-25 NPCs visible at any time. NPCs wear business casual.

---

### 3.2 Residential

**Theme:** Quiet neighborhoods, tree-lined streets, parks. A mix of apartments and small houses. Warm tones: brick red, green lawns, warm yellows. The "home" district.

**Visual Identity:** 2-4 story buildings, front yards, small parks, playgrounds, corner stores. Calmer pace. More greenery than any other district.

**Property Types:**
| Type | Plot Size | Price Range | Approx. Plots |
|---|---|---|---|
| Small House | 30x30 | 2,000 - 6,000 Cr | 50 |
| Apartment Unit | 20x20 | 1,000 - 3,000 Cr | 80 |
| Duplex | 30x20 | 2,500 - 5,000 Cr | 30 |
| Corner Shop | 20x20 | 1,500 - 4,000 Cr | 20 |

**Key Landmarks:**
- **Haven Park** (450, 1600) — Large green space (100x100 units). Social gathering area, events.
- **Sunrise Apartments** (350, 1300) — Starter housing complex. Cheapest apartments in the city.
- **Community Center** (600, 1500) — Mission board for residential jobs (delivery, landscaping, etc.).
- **School** (300, 1700) — Decorative landmark, NPC activity hub.

**NPC Density:** Moderate. Residents walking dogs, joggers, mail carriers, kids (daytime). 8-15 NPCs visible. NPCs wear casual clothing.

---

### 3.3 Industrial

**Theme:** Warehouses, factories, freight yards. Gritty and utilitarian. Gray concrete, rust orange, chain-link fences, steam vents. The working backbone of the city.

**Visual Identity:** Large boxy buildings, smokestacks, loading docks, parked trucks, rail tracks. Fewer decorative elements. Wide roads for "freight."

**Property Types:**
| Type | Plot Size | Price Range | Approx. Plots |
|---|---|---|---|
| Warehouse | 50x50 | 3,000 - 8,000 Cr | 25 |
| Small Factory | 40x40 | 5,000 - 15,000 Cr | 15 |
| Workshop / Garage | 20x30 | 1,500 - 4,000 Cr | 40 |
| Storage Lot | 30x30 | 1,000 - 2,500 Cr | 30 |

**Key Landmarks:**
- **Haven Freight Yard** (1500, 1800) — Large non-purchasable area. Job source for hauling/logistics missions.
- **Power Plant** (1800, 1700) — Visual landmark, smoke and lights. Non-purchasable.
- **Trade Depot** (1300, 1400) — Bulk trading post. Players sell crafted/manufactured goods here for credits.
- **Scrapyard** (1700, 1500) — Salvage missions, resource gathering.

**NPC Density:** Low-moderate. Dock workers, forklift operators, truck drivers, security guards. 5-12 NPCs visible. NPCs wear work gear, hard hats, overalls.

---

### 3.4 Waterfront

**Theme:** Coastal luxury. Marina, boardwalk, seafood restaurants, upscale living. Azure blue water, white wood, nautical accents. The aspirational district.

**Visual Identity:** Open water views, boat docks, a wooden boardwalk, pastel-colored buildings, palm trees (or equivalent), string lights at night. The prettiest district.

**Property Types:**
| Type | Plot Size | Price Range | Approx. Plots |
|---|---|---|---|
| Waterfront Condo | 25x25 | 6,000 - 20,000 Cr | 30 |
| Seafood Restaurant | 20x30 | 5,000 - 15,000 Cr | 15 |
| Marina Slip (boat dock) | 15x30 | 3,000 - 8,000 Cr | 20 |
| Boutique Shop | 15x20 | 4,000 - 10,000 Cr | 25 |
| Beach Bar | 20x20 | 3,500 - 9,000 Cr | 10 |

**Key Landmarks:**
- **Haven Marina** (1700, 150) — Boat docks, future water vehicle content.
- **The Boardwalk** (1300, 100) to (1900, 100) — Pedestrian promenade along the water. Vendor stalls.
- **Lighthouse** (1950, 50) — Southeast corner. Visible from most of the city. Observation point.
- **Fish Market** (1500, 200) — Daily NPC economy, fishing minigame hook.

**NPC Density:** Moderate. Tourists, fishermen, street performers, waitstaff. 10-18 NPCs visible. NPCs wear resort/casual attire.

---

### 3.5 Entertainment

**Theme:** Nightlife, culture, creativity. Neon signs, music venues, theaters, street art. Purple, magenta, neon green accents. The most visually vibrant district, especially at night.

**Visual Identity:** Marquee signs, graffiti murals, stage lights, outdoor seating, buskers. Buildings are colorful and eccentric. Strong day/night transformation (subdued by day, electric at night).

**Property Types:**
| Type | Plot Size | Price Range | Approx. Plots |
|---|---|---|---|
| Nightclub / Bar | 30x30 | 4,000 - 12,000 Cr | 20 |
| Theater / Venue | 40x40 | 6,000 - 18,000 Cr | 10 |
| Art Gallery | 20x30 | 3,000 - 8,000 Cr | 15 |
| Food Stand | 10x10 | 500 - 2,000 Cr | 30 |
| Music Studio | 20x20 | 2,500 - 7,000 Cr | 15 |

**Key Landmarks:**
- **The Grand Stage** (500, 800) — Open-air amphitheater (80x60 units). Player events, concerts, gatherings.
- **Neon Alley** (400, 600) to (400, 900) — A narrow pedestrian street packed with small venues and food stalls. The iconic "night strip."
- **Haven Cinema** (600, 700) — Decorative landmark, possible future content (player-created screenings).
- **Street Art Walk** (300, 500) to (700, 500) — Murals and installations, screenshot hotspot.

**NPC Density:** Varies by time. Day: 5-10 (staff, artists). Night: 15-25 (partygoers, performers, bouncers). NPCs wear flashy, artistic outfits at night.

---

## 4. Spawn Point

**Location:** City Hall Plaza, Downtown — (1400, 800)

**Rationale:** New players arrive at the civic center of the city. This puts them in the most active district, surrounded by shops, NPCs, and other players. From City Hall, all five districts are reachable within 2-3 minutes of walking.

**New Player Flow:**
1. Spawn at City Hall Plaza facing south (toward the bay — a strong first visual impression).
2. A short NPC tutorial interaction introduces movement, the map, and the bus system.
3. The mission board at City Hall offers starter jobs that guide the player to different districts.
4. Nearest affordable housing is in the Residential district (~2 min walk northwest via Ring Road, or one bus stop).

---

## 5. Navigation Flow

### Natural Player Paths

The city is designed so players flow in a figure-eight pattern around the river:

```
        Residential ---- Ring Road ---- Industrial
             |                              |
             |                              |
        Entertainment -- Bridge -- Downtown
             |                              |
             |                              |
        (Bayshore Dr) ----------- Waterfront
```

### Key Intersections

1. **Grand Crossing** (1000, 1000) — Haven Blvd meets Central Ave. The exact center of the map. Roundabout design. Bus hub with routes to all 5 districts.
2. **North Junction** (1000, 1600) — Ring Road meets Central Ave. Gateway between Residential and Industrial.
3. **Bayshore Split** (700, 200) — Where Bayshore Drive meets the river crossing. Gateway between Entertainment and Waterfront.
4. **Bridge Plaza** (1100, 1000) — West end of Grand Bridge. Transition between Entertainment and Downtown. High foot traffic.

### Travel Times (walking at 5 units/sec)

| From -> To | Distance (approx.) | Walk Time |
|---|---|---|
| Downtown center -> Waterfront center | ~500 units | ~100 sec (1:40) |
| Downtown center -> Entertainment center | ~950 units | ~190 sec (3:10) |
| Downtown center -> Industrial center | ~800 units | ~160 sec (2:40) |
| Downtown center -> Residential center | ~1150 units | ~230 sec (3:50) |
| Entertainment center -> Residential center | ~750 units | ~150 sec (2:30) |
| Entertainment center -> Waterfront center | ~1200 units | ~240 sec (4:00) |
| Any district center -> nearest bus stop | ~150 units | ~30 sec |
| Bus ride (any stop to any stop) | — | 5 sec wait + instant |

The longest walk in the game (Residential to Waterfront, diagonal) is about 1600 units / 320 seconds (~5.3 minutes). Bus travel keeps the effective max transit time under 1 minute for players who use it.

---

## 6. Scale Reference

### Unit Meanings

| Measurement | Units | Real-World Feel |
|---|---|---|
| Player character width | ~1 unit | ~0.5 meters |
| Standard road width | 30 units | ~15 meters (two lanes + sidewalks) |
| Small building plot | 20x20 units | ~10x10 meters (a small shop) |
| Medium building plot | 30x30 units | ~15x15 meters (a house) |
| Large building plot | 50x50 units | ~25x25 meters (a warehouse) |
| City block | ~80x80 units | ~40x40 meters |
| District (avg.) | ~700x700 units | ~350x350 meters |
| Full city | 2000x2000 units | ~1 km x 1 km |
| Walking past a shop front | 20 units | 4 seconds |
| Walking one city block | 80 units | 16 seconds |
| Crossing a district | ~700 units | ~2.3 minutes |
| Crossing the entire city | ~2000 units | ~6.7 minutes |

### Plot Capacity Estimate

Total purchasable plots across all districts: approximately **605**

| District | Total Plots | Avg. Price |
|---|---|---|
| Downtown | ~155 | ~8,000 Cr |
| Residential | ~180 | ~2,500 Cr |
| Industrial | ~110 | ~4,000 Cr |
| Waterfront | ~100 | ~8,500 Cr |
| Entertainment | ~90 | ~5,500 Cr |

At 50 concurrent players, there are roughly 12 plots per player, ensuring the world does not feel fully owned too quickly while still allowing meaningful scarcity in premium locations.

---

## Open Questions

1. **Vertical scale:** How tall should buildings render? The current design is 2D in layout terms. Need art direction on whether Downtown towers are 5x or 20x the height of residential houses.
2. **River width:** Specified as ~100 units. Is this too wide for visual appeal, or should it be narrower (50 units) with the bridge being shorter?
3. **Future expansion:** The 2000x2000 world is fixed in constants. Should we reserve space for a 6th district (e.g., Suburbs, University) or is the current layout final?
4. **Interior scale:** Building interiors are instanced per the GDD. How large should interior spaces be relative to exterior plot size? 1:1 or TARDIS-style larger-inside?
5. **Water gameplay:** The bay and river are currently decorative/boundary. Should we plan for swimmable water, boats, or fishing from the start?
