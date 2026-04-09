# ThirdLife — Job System Specification

## 1. Overview

Jobs are the primary income source for new players. This document specifies the four **starter jobs** available from the moment a player first enters Haven Point. All starter jobs have no unlock requirements and are designed to teach core mechanics (movement, navigation, interaction) while providing meaningful income.

**Design Principles:**
- Every job must involve active gameplay. No idle income.
- Jobs introduce the player to different districts organically.
- Pay scales reward speed and efficiency but never punish slow learners harshly.
- The server is the sole authority for job state, payout calculation, and completion validation.

**General Rules (all jobs):**
- A player can hold **one active job at a time**.
- Accepting a new job while one is active forfeits the current job (no partial payout).
- **Job cooldown:** 60 seconds after completing or forfeiting a job before the same job type can be accepted again. Different job types have no shared cooldown.
- Job NPCs are marked on the minimap with a briefcase icon when the player has no active job.
- All payouts are calculated and applied server-side. The client displays estimated pay but the server enforces the real amount.

---

## 2. Job Definitions

### 2.1 Delivery Driver

**Available Districts:** All (NPC givers in every district)

**Concept:** Pick up a package from an NPC, carry it to a destination NPC. Simple A-to-B navigation under a time limit.

#### Start Locations

| NPC Name | Location | Coordinates | District |
|----------|----------|-------------|----------|
| Courier Dispatcher (City Hall) | City Hall Plaza | (1400, 800) | Downtown |
| Courier Dispatcher (Community Center) | Community Center | (600, 1500) | Residential |
| Courier Dispatcher (Trade Depot) | Trade Depot | (1300, 1400) | Industrial |
| Courier Dispatcher (Fish Market) | Fish Market | (1500, 200) | Waterfront |
| Courier Dispatcher (Grand Stage) | Near Grand Stage | (500, 800) | Entertainment |

#### How to Accept

1. Player approaches a Courier Dispatcher NPC (highlighted with interaction prompt when within 5 units).
2. Player presses **E** to interact.
3. Dialog box appears: *"I've got a package that needs delivering. Interested?"*
4. Player selects **[Accept Delivery]** or **[No Thanks]**.
5. On accept: package appears in player's hand (cosmetic), destination marker appears on minimap and in-world as a glowing waypoint.

#### Step-by-Step Gameplay Flow

1. **Package pickup** — An item icon appears on-screen ("Package for [destination name]"). A 2-minute countdown timer starts in the HUD.
2. **Navigate to destination** — The destination is a randomly selected NPC location in a *different* district from the pickup point. The waypoint guides the player.
3. **Deliver the package** — Player walks within 3 units of the destination NPC and presses **E** to hand over the package.
4. **Completion** — Timer stops, payout is calculated and credited immediately. A brief confirmation message appears: *"Delivery complete! +XX CR"*

#### Destination Pool

Deliveries always go to a different district than the pickup. Destinations are selected from key landmarks:

| Destination | Coordinates | District |
|-------------|-------------|----------|
| City Hall | (1400, 800) | Downtown |
| Central Market | (1350, 600) | Downtown |
| Community Center | (600, 1500) | Residential |
| Sunrise Apartments | (350, 1300) | Residential |
| Trade Depot | (1300, 1400) | Industrial |
| Haven Freight Yard | (1500, 1800) | Industrial |
| Fish Market | (1500, 200) | Waterfront |
| Haven Marina | (1700, 150) | Waterfront |
| Grand Stage | (500, 800) | Entertainment |
| Neon Alley Entrance | (400, 600) | Entertainment |

#### Completion Conditions

- Player must be within 3 units of the destination NPC.
- Player must press E to interact (hand over package).
- Must be completed within the 2-minute time limit.
- If the timer expires, the job fails: *"Delivery failed — package returned."* No payout. The 60-second cooldown still applies.

#### Credit Payout Formula

```
base_pay = 50 CR
time_bonus = floor((remaining_seconds / 120) * 30)
payout = base_pay + time_bonus
```

- **Minimum payout (delivered at last second):** 50 CR
- **Maximum payout (delivered instantly, theoretical):** 80 CR
- **Typical payout (delivered with ~60s remaining):** 65 CR

The `time_bonus` rewards fast delivery. A player who completes the delivery with 60 seconds left earns 50 + 15 = 65 CR.

#### Cooldown

60 seconds after completion or failure before the player can accept another Delivery Driver job. Other job types are immediately available.

---

### 2.2 Street Cleaner

**Available Districts:** Residential, Downtown

**Concept:** Walk to 5 marked spots in the district and interact with each (press E) to "clean" them. A roaming cleanup task.

#### Start Locations

| NPC Name | Location | Coordinates | District |
|----------|----------|-------------|----------|
| Sanitation Foreman (Community Center) | Community Center | (600, 1500) | Residential |
| Sanitation Foreman (City Hall) | City Hall Plaza | (1400, 800) | Downtown |

#### How to Accept

1. Player approaches a Sanitation Foreman NPC.
2. Player presses **E** to interact.
3. Dialog: *"The streets need a good sweep. Want to help out? I'll mark 5 spots for you."*
4. Player selects **[Start Cleaning]** or **[Not Right Now]**.
5. On accept: 5 cleanup markers appear on the minimap within the current district.

#### Step-by-Step Gameplay Flow

1. **Job accepted** — 5 glowing ground markers spawn at random positions within the district (minimum 30 units apart from each other, within 200 units of the NPC). No strict time limit, but an idle timer of 5 minutes starts (resets on each interaction).
2. **Walk to marker 1** — Player approaches a marker (within 2 units). A prompt appears: *"[E] Clean"*.
3. **Interact** — Player presses E. A brief 2-second animation plays (player character bends down). The marker disappears. HUD updates: "1/5 cleaned."
4. **Repeat** for markers 2 through 5. Each marker is cleaned the same way.
5. **All 5 cleaned** — Job completes automatically. Payout message: *"Area clean! +XX CR"*

#### Marker Spawn Regions

Markers spawn within the district boundaries near walkable paths:

| District | Spawn Bounds |
|----------|-------------|
| Residential | (200, 1200) to (800, 1800) — near parks, sidewalks, Community Center |
| Downtown | (1200, 500) to (1700, 900) — near City Hall, Central Market, sidewalks |

#### Completion Conditions

- All 5 markers must be interacted with (pressed E while within 2 units).
- No required order. Player can clean them in any sequence.
- If the player is idle (no input) for 5 minutes, the job is auto-cancelled with no payout.
- If the player leaves the district (crosses the district boundary), the job is cancelled with no payout. A warning appears at 50 units from the boundary: *"You're leaving the cleanup area!"*

#### Credit Payout Formula

```
per_spot = random(30, 40)   // server-side random per spot
payout = sum of 5 spot payouts
```

- **Minimum payout:** 5 x 30 = 150 CR (total for all 5)
- **Maximum payout:** 5 x 40 = 200 CR (total for all 5)
- **Displayed to player as:** 30-50 CR per area (individual spot payout shown on each clean)

Wait -- the task spec says 30-50 CR per area cleaned. Adjusting:

```
per_spot = random(30, 50)   // server-side random per spot
payout = sum of 5 spot payouts
```

- **Minimum payout:** 5 x 30 = 150 CR (total)
- **Maximum payout:** 5 x 50 = 250 CR (total)
- **Average payout per job:** ~200 CR
- Each spot's payout is shown individually as the player cleans it.

#### Cooldown

60 seconds after completion or cancellation.

---

### 2.3 Security Guard

**Available Districts:** Industrial, Waterfront

**Concept:** Patrol between 3-4 checkpoints in order within a time limit. Tests navigation and route planning.

#### Start Locations

| NPC Name | Location | Coordinates | District |
|----------|----------|-------------|----------|
| Security Chief (Freight Yard) | Haven Freight Yard entrance | (1500, 1800) | Industrial |
| Security Chief (Marina) | Haven Marina | (1700, 150) | Waterfront |

#### How to Accept

1. Player approaches a Security Chief NPC.
2. Player presses **E** to interact.
3. Dialog: *"Need someone to walk the perimeter. Hit each checkpoint in order — I'll be watching."*
4. Player selects **[Start Patrol]** or **[Maybe Later]**.
5. On accept: 3 or 4 checkpoint markers appear on the minimap, numbered 1 through N. A 3-minute countdown timer starts.

#### Step-by-Step Gameplay Flow

1. **Job accepted** — Checkpoint markers appear in the world as numbered pillars of light. The first checkpoint is highlighted more brightly. Timer: 3:00.
2. **Walk to Checkpoint 1** — Player must reach within 3 units of the marker. On arrival, the marker turns green and a chime plays. *"Checkpoint 1 — clear."* Next checkpoint highlights.
3. **Walk to Checkpoint 2** — Same interaction. *"Checkpoint 2 — clear."*
4. **Walk to Checkpoint 3** — Same. If 4 checkpoints were assigned, continue to Checkpoint 4.
5. **All checkpoints visited** — Job completes. *"Patrol complete! +XX CR"*

#### Checkpoint Placement

Checkpoints are placed at fixed patrol routes within each district:

**Industrial Patrol Route (4 checkpoints):**
| Checkpoint | Location | Coordinates |
|------------|----------|-------------|
| 1 | Freight Yard Gate | (1500, 1800) |
| 2 | Trade Depot Loading Bay | (1300, 1400) |
| 3 | Scrapyard Perimeter | (1700, 1500) |
| 4 | Power Plant Fence | (1800, 1700) |

Total route distance: ~900 units. At 5 units/sec, minimum walk time is ~180 seconds (3:00). The 3-minute timer makes this tight but achievable if the player moves efficiently with no detours.

**Waterfront Patrol Route (3 checkpoints):**
| Checkpoint | Location | Coordinates |
|------------|----------|-------------|
| 1 | Marina Entrance | (1700, 150) |
| 2 | Boardwalk Midpoint | (1600, 100) |
| 3 | Fish Market Rear | (1500, 200) |

Total route distance: ~350 units. At 5 units/sec, minimum walk time is ~70 seconds. Generous time for a 3-minute limit; this is the easier patrol.

#### Completion Conditions

- All checkpoints must be visited **in numbered order**. Visiting Checkpoint 3 before Checkpoint 2 does not count — the player must backtrack.
- Player must be within 3 units of each checkpoint marker.
- Must complete within 3 minutes.
- If timer expires, the job fails: *"Patrol incomplete. Report back."* No payout.
- Checkpoints already visited remain green (no need to revisit).

#### Credit Payout Formula

```
base_pay = 60 CR
time_bonus = floor((remaining_seconds / 180) * 40)
payout = base_pay + time_bonus
```

- **Minimum payout (completed at last second):** 60 CR
- **Maximum payout (theoretical instant completion):** 100 CR
- **Typical payout (Industrial, tight route, ~30s remaining):** 60 + 6 = 66 CR
- **Typical payout (Waterfront, easy route, ~100s remaining):** 60 + 22 = 82 CR

The Waterfront patrol pays more on average because it is shorter, balancing out the fact that it has fewer checkpoints and feels less challenging.

#### Cooldown

60 seconds after completion or failure.

---

### 2.4 Shop Assistant

**Available Districts:** Downtown, Entertainment

**Concept:** Stand near a shop counter for 30 seconds to simulate a work shift. Simple and low-effort, designed as a calm alternative to movement-heavy jobs. Can be repeated up to 3 shifts in a row.

#### Start Locations

| NPC Name | Location | Coordinates | District |
|----------|----------|-------------|----------|
| Shop Manager (Central Market) | Central Market | (1350, 600) | Downtown |
| Shop Manager (Grand Stage) | Near Grand Stage vendor area | (500, 800) | Entertainment |

#### How to Accept

1. Player approaches a Shop Manager NPC.
2. Player presses **E** to interact.
3. Dialog: *"Short-staffed today. Want to cover the counter for a bit? Pay's decent."*
4. Player selects **[Start Shift]** or **[No Thanks]**.
5. On accept: A work zone marker appears near the NPC (a glowing rectangle on the ground, ~5x5 units).

#### Step-by-Step Gameplay Flow

1. **Job accepted** — Work zone appears near the shop counter. Player must walk into the zone.
2. **Enter work zone** — A progress bar appears in the HUD: "Working... 0/30s". The bar fills over 30 real-time seconds.
3. **Stay in the zone** — The player must remain within the 5x5 unit work zone for the full 30 seconds. Moving outside the zone pauses the progress bar and shows: *"Return to the counter!"* The timer does not reset; it resumes when the player re-enters.
4. **Shift complete** — After 30 seconds of time in the zone: *"Shift complete! +XX CR"*
5. **Optional: Continue?** — A prompt appears: *"Want to do another shift? (X/3 completed)"* Player can select **[Another Shift]** or **[I'm Done]**.
6. **Repeat** up to 3 shifts total. Each shift pays independently.

#### Completion Conditions

- Player must accumulate 30 seconds of standing within the work zone per shift.
- Leaving the zone pauses but does not cancel (grace: player has up to 60 seconds outside the zone before the shift is auto-cancelled).
- If the player moves more than 50 units from the work zone, the shift is cancelled with no payout.
- Maximum 3 consecutive shifts. After 3, the job ends and cooldown begins.

#### Credit Payout Formula

```
per_shift = random(40, 60)   // server-side random, rolled once at shift start
total = sum of completed shifts
```

- **Minimum payout (1 shift, low roll):** 40 CR
- **Maximum payout (3 shifts, high rolls):** 180 CR
- **Average payout (3 shifts):** 150 CR
- **Time investment for 3 shifts:** ~90 seconds of standing + travel time

#### Cooldown

60 seconds after completing all shifts or leaving mid-job. The cooldown starts after the final shift is completed or the player declines to continue.

---

## 3. Earning Rate Analysis

Comparing starter jobs against the economy document's target of 300-500 CR/hr for a new player's first hour:

| Job | Avg. Payout per Run | Avg. Time per Run (incl. travel + cooldown) | Estimated CR/hr |
|-----|---------------------|---------------------------------------------|-----------------|
| Delivery Driver | ~65 CR | ~3 min (2 min delivery + 1 min cooldown) | ~1,300 CR/hr |
| Street Cleaner | ~200 CR | ~5 min (4 min cleaning + 1 min cooldown) | ~2,400 CR/hr |
| Security Guard (Industrial) | ~66 CR | ~4 min (3 min patrol + 1 min cooldown) | ~990 CR/hr |
| Security Guard (Waterfront) | ~82 CR | ~2.5 min (1.5 min patrol + 1 min cooldown) | ~1,970 CR/hr |
| Shop Assistant (3 shifts) | ~150 CR | ~3.5 min (1.5 min shifts + 1 min travel + 1 min cooldown) | ~2,570 CR/hr |

**Note:** These theoretical maximums assume perfect play with zero downtime. Real new players will earn significantly less because they will:
- Spend time reading dialogs and learning the UI
- Get lost navigating to destinations
- Fail some deliveries/patrols
- Take breaks to explore

The economy doc targets 300-500 CR/hr for the first hour including the 200 CR tutorial bonus and 500 CR starting balance. These job rates allow a new player who spends half their time doing jobs and half exploring to hit roughly 400-600 CR/hr from jobs alone, which aligns with the hour 2-10 target of 400-700 CR/hr.

**Balancing note:** If playtesting shows these rates are too high, the simplest lever is reducing the per-delivery/per-spot/per-shift payout by 10-20%. The time_bonus on Delivery Driver and Security Guard can also be reduced by lowering the bonus multiplier.

---

## 4. Job UI Elements

### HUD During Active Job

- **Job name** — Top-left, below minimap. E.g., "Delivery Driver"
- **Timer** — (if applicable) Countdown displayed prominently. Turns red below 30 seconds.
- **Progress** — Job-specific. "1/5 cleaned" for Street Cleaner, "2/4 checkpoints" for Security Guard, "Working... 15/30s" for Shop Assistant.
- **Waypoint marker** — In-world glowing column at next objective. Also shown on minimap.
- **Pay estimate** — Small text: "Est. pay: 50-80 CR"

### Job Board (Future Enhancement)

A Job Board UI accessible at any job NPC could show all available jobs, their locations, and estimated pay ranges. For the initial implementation, job NPCs offer only their specific job type through direct interaction.

---

## 5. Server Implementation Notes

- Job state is tracked per-player on the Colyseus room state: `{ activeJob: JobType | null, jobData: { ... } }`
- Timer countdown is server-authoritative. The client displays a synced timer but the server decides completion/failure.
- Checkpoint positions and cleanup marker positions are generated server-side on job acceptance and sent to the client.
- Payout random rolls happen server-side at the moment of completion (or per-spot for Street Cleaner).
- The client sends intents: `job:accept`, `job:interact` (for E-press at a marker), `job:cancel`. The server validates player position and state before acting.

---

## 6. Open Questions

1. **Scaling pay with player count:** Should job pay decrease when many players are doing the same job simultaneously? The economy doc's faucet cap handles this globally, but per-job throttling could smooth it further.
2. **Job variety expansion:** These 4 starter jobs cover the basics. When should the next tier of jobs (Office Worker, Mechanic, Club Promoter from the economy doc) be fully specified?
3. **Delivery destinations within same district:** Currently deliveries always cross districts. Should there be shorter, lower-paying same-district deliveries for players who want to stay local?
4. **Visual feedback:** Should cleanup spots show trash/debris that disappears when cleaned? Should the delivery package be a visible item the player carries? These are art pipeline questions.
5. **Group jobs:** Can two players do a job together (e.g., both patrol as security)? Current design is solo only. Group jobs could be a future social feature.
