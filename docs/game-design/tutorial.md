# ThirdLife — New Player Tutorial Flow

## 1. Overview

The tutorial runs approximately **5 minutes** and teaches five core skills: movement, camera control, chat, completing a job, and understanding property. It is triggered automatically when a new player first spawns and cannot be skipped on the first login (can be replayed later via City Hall).

**Design Principles:**
- Learn by doing, not by reading. Minimal text walls.
- The player is always moving, never stuck in a menu for more than 10 seconds.
- The tutorial doubles as a city introduction — the player visits 2 districts.
- The 200 CR tutorial completion bonus (per economy doc) is awarded at the end.

**Spawn Point:** City Hall Plaza, Downtown — (1400, 800), facing south toward the bay.

---

## 2. Tutorial Sequence

### Step 1: Movement (0:00 - 0:45)

**Location:** City Hall Plaza (1400, 800)

**Trigger:** Immediate on first spawn. The screen fades in from white.

**On-screen prompt:**
> Welcome to Haven Point.
> Use **W A S D** to move around.

A glowing ground marker appears **20 units south** of the player at (1400, 780). This is close enough to reach in 4 seconds at walking speed.

**Player action:** Walk to the marker using WASD.

**On reaching the marker:**
- Marker disappears with a soft chime.
- A second marker appears **30 units west** at (1370, 780).

**Player action:** Walk to the second marker.

**On reaching the second marker:**
- Prompt clears. Brief flash: *"Nice! You've got the basics."*
- Transition to Step 2.

**Fail-safe:** If the player does not move within 30 seconds, the prompt pulses and adds: *"Press W to walk forward."*

---

### Step 2: Camera Control (0:45 - 1:15)

**Location:** Still near City Hall Plaza, roughly (1370, 780)

**On-screen prompt:**
> Move your **mouse** to look around.
> Try looking at Haven Tower to the east.

Haven Tower is at (1500, 700), which is to the southeast of the player's current position. An arrow indicator on the HUD edge points toward the tower.

**Player action:** Rotate the camera until Haven Tower is roughly centered on screen.

**Detection:** The server/client checks if the player's camera forward vector is within 30 degrees of the direction toward Haven Tower for at least 1 second.

**On success:**
- Prompt: *"That's Haven Tower — the tallest building in the city."*
- Brief pause (2 seconds), then transition to Step 3.

**Fail-safe:** After 20 seconds without success, the prompt adds: *"Move your mouse left or right to rotate the camera."*

---

### Step 3: Chat (1:15 - 1:45)

**Location:** Same area, (1370, 780)

**On-screen prompt:**
> Press **Enter** to open chat. Type anything and press **Enter** again to send.

The chat input box highlights with a subtle glow.

**Player action:** Press Enter, type any message (minimum 1 character), press Enter to send.

**On success:**
- The player's message appears in the chat log as normal.
- Prompt: *"Other players nearby will see your messages. Say hi!"*
- A tutorial NPC named **Officer Dawn** appears at (1380, 790), walking toward the player. She has a speech bubble: *"Hey, new in town? I've got a quick job for you."*
- Transition to Step 4.

**Fail-safe:** After 30 seconds, the prompt adds: *"Press the Enter key on your keyboard to start typing."*

---

### Step 4: First Job — Guided Delivery (1:45 - 3:45)

**Location:** Starts at City Hall Plaza area. Destination: Central Market (1350, 600).

This step teaches the job system using a scripted Delivery Driver job. It follows the same mechanics as the standard Delivery Driver job (see `jobs.md`) but with extended time and extra guidance.

#### 4a: Accept the Job (1:45 - 2:00)

**Officer Dawn** stops near the player with an interaction prompt.

**On-screen prompt:**
> Walk up to **Officer Dawn** and press **E** to talk.

**Player action:** Walk within 5 units of Officer Dawn and press E.

**Dialog box:**
> **Officer Dawn:** "Welcome to Haven Point! Best way to learn the city is on foot. I need a package delivered to the Central Market — it's just south of here. Easy money."
>
> **[Accept Delivery]** / [Not Now]

If the player selects [Not Now], Dawn responds: *"No rush. Come talk to me when you're ready."* The prompt remains until they accept. Tutorial does not advance without accepting.

**On accept:**
- A package icon appears in the HUD.
- A waypoint marker appears at Central Market (1350, 600), ~200 units south of the player.
- A **5-minute timer** starts (generous — normal deliveries are 2 minutes, but this is tutorial-paced).
- On-screen prompt: *"Follow the waypoint to the Central Market."*

#### 4b: Navigate to Central Market (2:00 - 3:15)

**Player action:** Walk south along the streets toward the Central Market waypoint.

**Distance:** ~200 units from (1370, 780) to (1350, 600). At 5 units/sec, this takes ~40 seconds of straight walking. New players will likely take 60-75 seconds with exploration and meandering.

**Guidance along the way:**
- At 15 seconds: if the player hasn't moved more than 30 units toward the destination, a gentle nudge appears: *"The Central Market is to the south. Follow the waypoint on your minimap."*
- When the player is within 50 units of Central Market: *"Almost there! Look for the glowing marker."*

#### 4c: Complete the Delivery (3:15 - 3:45)

A tutorial NPC named **Marco** stands at Central Market (1350, 600) with a glowing interaction indicator.

**On-screen prompt:**
> Walk up to **Marco** and press **E** to deliver the package.

**Player action:** Walk within 3 units of Marco and press E.

**Dialog box:**
> **Marco:** "Ah, my package! Thanks, friend. Here's your pay."

**Payout:** 75 CR (fixed, not random — tutorial delivery always pays 75 CR).

**On-screen:**
> *"Delivery complete! +75 CR"*
> *"You now have 575 CR. You can pick up more jobs from NPCs with the briefcase icon."*

The briefcase icons briefly pulse on the minimap for 3 seconds to show job NPC locations.

Transition to Step 5.

---

### Step 5: First Property Visit (3:45 - 5:00)

**Location:** Central Market (1350, 600) to a nearby purchasable plot.

This step introduces the property system without requiring a purchase.

#### 5a: Point Toward a Cheap Plot (3:45 - 4:00)

**On-screen prompt:**
> Every building in Haven Point can be owned by a player.
> Let's check out a property nearby.

A new waypoint appears at a small retail shop plot near Central Market. The nearest purchasable plot in Downtown is approximately at **(1300, 650)** — a small shop plot, 20x20 units, listed at ~3,000 CR.

#### 5b: Walk to the Plot (4:00 - 4:30)

**Player action:** Walk ~70 units to the marked plot (~14 seconds of walking).

**On arriving within 5 units of the plot:**

The plot boundary highlights with a blue outline. A property info panel slides in from the right side of the screen:

```
+-----------------------------+
|  SMALL RETAIL SHOP          |
|  Downtown District          |
|  Plot: 20x20                |
|  Price: 3,000 CR            |
|  Your balance: 575 CR       |
|  Status: Available           |
+-----------------------------+
|  [Browse More Properties]   |
+-----------------------------+
```

**On-screen prompt:**
> This shop costs **3,000 CR**. You've got 575 CR right now.
> Keep working jobs and you'll own property in no time.

#### 5c: Tutorial Complete (4:30 - 5:00)

After 5 seconds viewing the property panel:

**On-screen prompt (centered, larger text):**
> **Tutorial Complete!**
> +200 CR bonus
>
> You now have **775 CR**.
>
> Haven Point is yours to explore. Pick up jobs, earn credits, and build your empire.

The 200 CR tutorial completion bonus is awarded (per economy doc Section 2.4).

**Final tips (shown as dismissable tooltip cards in the corner, one at a time):**

1. *"Job NPCs are marked with a briefcase icon on your minimap."*
2. *"Press M to open the full city map."*
3. *"Bus stops let you fast-travel between districts for 25 CR."*

After 10 seconds or when the player dismisses the cards, all tutorial UI elements clear. The player is now in free play.

---

## 3. Tutorial State Tracking

The server tracks tutorial progress per-player:

```
tutorialState: {
  completed: boolean,          // true after Step 5c
  currentStep: 1 | 2 | 3 | 4 | 5 | null,
  step4Timer: number | null,   // countdown for the delivery
  tutorialBonusPaid: boolean   // prevents double-paying the 200 CR
}
```

- Tutorial progress persists across disconnects. If a player disconnects mid-tutorial and reconnects, they resume at the last completed step.
- The tutorial NPC (Officer Dawn) only appears for players in the tutorial. Other players do not see her.
- Tutorial completion is a one-time flag. Players can replay the tutorial from a City Hall kiosk, but the 200 CR bonus is not re-awarded.

---

## 4. Timeline Summary

| Time | Step | Location | What Player Learns |
|------|------|----------|--------------------|
| 0:00 - 0:45 | Movement | City Hall Plaza (1400, 800) | WASD movement |
| 0:45 - 1:15 | Camera | City Hall Plaza (1370, 780) | Mouse camera control |
| 1:15 - 1:45 | Chat | City Hall Plaza (1370, 780) | Enter to chat |
| 1:45 - 3:45 | First Job | City Hall to Central Market (1350, 600) | Job accept, navigate, deliver |
| 3:45 - 5:00 | Property | Central Market to nearby plot (1300, 650) | Property system introduction |

**Total time:** ~5 minutes for an average player. Fast players may complete in 3.5 minutes. Slow/exploratory players may take 7-8 minutes.

**Credits earned during tutorial:**
- Starting balance: 500 CR
- Delivery payout: 75 CR
- Tutorial bonus: 200 CR
- **Total after tutorial: 775 CR**

This puts the player well on track to buy their first clothing item (50 CR target at 15 minutes per economy doc) and gives them a clear sense of agency and progress.

---

## 5. Open Questions

1. **Skip button for returning players:** Should players who have already completed the tutorial on another character be able to skip? If so, they would still receive the 200 CR bonus but miss the 75 CR delivery. Alternatively, award the full 275 CR on skip.
2. **Multiplayer visibility during tutorial:** Should new players in the tutorial see other players, or should they be in a brief instanced/phased state? Seeing other players running around adds life but might distract from tutorial prompts.
3. **Voice/audio guidance:** Should Officer Dawn have voice lines, or is text-only sufficient for the web platform? Text-only is simpler and more accessible.
4. **Tutorial failure:** What if the player somehow fails the delivery (extremely unlikely with the 5-minute timer)? Restart Step 4, or just award the 75 CR anyway since it is tutorial-scripted?
5. **Localization:** All tutorial text needs to be externalized for future localization. Flag all strings in this document as requiring i18n keys.
