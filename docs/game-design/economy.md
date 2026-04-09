# ThirdLife — Economy Design Document

## 1. Currency System

### Credits
Credits (CR) are the sole in-game currency. There is no premium/real-money currency at launch.

| Parameter | Value |
|-----------|-------|
| Starting balance (new player) | 500 CR |
| Display format | Whole numbers, comma-separated (e.g. 12,500 CR) |
| Minimum transaction | 1 CR |
| Maximum player wallet | 50,000,000 CR |
| Decimal places | None — integer only |

### Currency Flow Principle
The economy is designed as a **closed loop with controlled leaks**. Every CR entering the system (faucets) must be roughly balanced by CR leaving the system (sinks). The server is the sole authority for all balance mutations — the client never modifies currency directly.

---

## 2. Income Sources (Faucets)

### 2.1 Jobs

Jobs are the primary income source for new players. A player can hold one active job at a time. Jobs require the player to be online and performing the associated activity (not idle).

| Job | District | Pay per Cycle (5 min) | Unlock Requirement |
|-----|----------|-----------------------|--------------------|
| Delivery Driver | Any | 30–50 CR | None |
| Store Clerk | Downtown / Residential | 25–40 CR | None |
| Dock Worker | Waterfront | 40–60 CR | None |
| Construction Worker | Industrial | 45–65 CR | None |
| Bartender | Entertainment | 35–55 CR | None |
| Office Worker | Downtown | 50–70 CR | Reputation Level 3 |
| Mechanic | Industrial | 55–75 CR | Reputation Level 5 |
| Club Promoter | Entertainment | 60–90 CR | Reputation Level 8 |

**Job Mechanics:**
- Jobs run in 5-minute **work cycles**. The player must complete a simple activity each cycle (e.g. drive to a waypoint, interact with an object).
- Pay varies within the range based on **performance** (speed, accuracy) and a small random factor.
- Missing a cycle interaction (AFK) pays 0 CR for that cycle and flags the session (see Section 6).
- Players can quit a job at any time. Switching jobs has a 10-minute cooldown.

### 2.2 Business Revenue

Players who own businesses earn revenue from other players' spending. Revenue is generated when a customer (another player) uses the business.

| Business Type | Revenue Model | Details |
|---------------|--------------|---------|
| Shop / Retail | Per sale | Owner sets prices for items; earns sale price minus 10% city tax |
| Apartment Complex | Rent | Tenants pay weekly rent set by owner; earns rent minus 10% city tax |
| Restaurant / Bar | Per order | Customers order food/drinks; owner earns order total minus 15% tax (higher service tax) |
| Nightclub / Venue | Cover charge + bar | Door fee + per-drink revenue; earns total minus 15% tax |
| Garage / Workshop | Service fee | Players pay for vehicle/item repairs; earns fee minus 10% tax |
| Office Building | Lease | Other players rent office space for job bonuses; earns lease minus 10% tax |

**Key Rules:**
- Revenue only flows when real players transact. NPC customers do not generate revenue.
- Businesses with zero customers for 7 consecutive real-time days enter **dormant** status (no maintenance cost, no revenue, property value decays 2% per week).
- The **city tax** (10–15%) is a primary currency sink (see Section 6).

### 2.3 Player-to-Player Trading

Players can trade items and CR directly. All trades are logged server-side.

- No trade tax on direct CR transfers (to keep social gifting friction-free).
- Item sales through a **Market Board** (global listing) incur a 5% listing fee (sink).
- Trade value cap: 500,000 CR per single transaction (anti-exploit measure).

### 2.4 Missions and Activities

One-time and repeatable activities that inject CR.

| Activity | Payout | Cooldown |
|----------|--------|----------|
| Welcome Tour (tutorial) | 200 CR (one-time) | Once |
| Daily Check-in | 50 CR | 24 hours |
| Scavenger Hunt | 100–300 CR | Weekly reset |
| Street Race | 150–500 CR (position-based) | 30 min |
| Delivery Rush (timed) | 80–250 CR | 15 min |
| District Cleanup | 60–120 CR | 1 hour |
| Community Event (server-wide) | 500–2,000 CR | When triggered by system |

**Daily passive income does NOT exist.** Players must actively participate to earn. This is a core design principle.

---

## 3. Expenses (Sinks)

### 3.1 Property Costs

| Cost Type | Frequency | Amount |
|-----------|-----------|--------|
| Property Purchase | One-time | See Section 4 |
| Weekly Rent (if renting, not owning) | Weekly | 5–8% of property value |
| Property Tax (owners) | Weekly | 2% of property value |
| Maintenance | Weekly | 1% of property value |

- If a player cannot pay property tax + maintenance for 3 consecutive weeks, the property is **repossessed** and returned to the market at 80% of its current value.

### 3.2 Business Operating Costs

| Cost Type | Frequency | Amount |
|-----------|-----------|--------|
| Stock / Supplies | Per restock | Varies by business (see 5.0) |
| Staff (NPC employees) | Weekly | 200–1,000 CR per staff member |
| Upgrades | One-time | 500–50,000 CR |
| Advertising (optional) | Per campaign | 100–2,000 CR |

### 3.3 Player Spending

| Category | Range |
|----------|-------|
| Clothing / Appearance | 20–500 CR per item |
| Furniture / Decor | 50–5,000 CR per item |
| Vehicle Purchase | 2,000–50,000 CR |
| Vehicle Maintenance | 100–500 CR per repair |
| Food & Drink (buff items) | 10–50 CR |

### 3.4 System Fees (Sinks Summary)

| Fee | Rate |
|-----|------|
| City tax on business revenue | 10–15% |
| Market Board listing fee | 5% |
| Property transfer fee (resale) | 8% of sale price |
| Fast travel (between districts) | 25 CR |
| Respawn/recovery after KO | 50 CR |

---

## 4. Property Market

### 4.1 District Pricing

Each district has a **base price multiplier** applied to the property's base value.

| District | Multiplier | Character | Example Properties |
|----------|------------|-----------|-------------------|
| Downtown | 2.0x | Premium commercial, high traffic | Offices, luxury shops, penthouses |
| Entertainment | 1.8x | Nightlife, high footfall | Clubs, bars, venues, arcades |
| Waterfront | 1.5x | Scenic, mixed use | Restaurants, marina shops, condos |
| Residential | 1.0x (base) | Affordable living, starter area | Apartments, small shops, garages |
| Industrial | 0.8x | Cheap, utilitarian | Warehouses, workshops, factories |

### 4.2 Property Base Values

| Property Type | Base Value (before district multiplier) |
|---------------|----------------------------------------|
| Small Apartment (1 room) | 2,000 CR |
| Medium Apartment (3 rooms) | 5,000 CR |
| Large Apartment (5 rooms) | 10,000 CR |
| Small Shop | 8,000 CR |
| Medium Shop | 15,000 CR |
| Large Shop | 30,000 CR |
| Restaurant / Bar | 20,000 CR |
| Nightclub / Venue | 40,000 CR |
| Office Building | 25,000 CR |
| Warehouse | 12,000 CR |
| Penthouse | 50,000 CR |

**Example:** A Small Shop in Downtown = 8,000 x 2.0 = **16,000 CR**.

### 4.3 Dynamic Pricing

Property values adjust based on activity:

- **Demand factor:** If >75% of a district's properties are owned, prices rise 1% per day (capped at +30% above base).
- **Decay factor:** If <25% of a district's properties are owned, prices drop 1% per day (floored at -20% below base).
- **Neighborhood bonus:** Properties adjacent to high-revenue businesses get +5–15% value.
- **Neglect penalty:** Dormant properties lose 2% value per week.
- Price recalculation runs once per real-time hour on the server.

### 4.4 Property Transactions

- **Buying from city:** Pay listed price. Available immediately.
- **Player-to-player sale:** Seller lists price. Buyer pays price + 8% transfer fee. Seller receives listed price minus 8% transfer fee (total 16% removed from economy per resale).
- **Auction:** Properties can be listed for auction (24-hour minimum). Starting bid must be >= 50% of current market value.

---

## 5. Business Types

### 5.1 Retail Shop

| Parameter | Value |
|-----------|-------|
| Purchase price | 8,000–60,000 CR (by size + district) |
| Stock cost per restock | 200–2,000 CR |
| Revenue per customer | 20–200 CR (owner sets prices) |
| NPC staff cost | 300 CR/week per clerk |
| Upgrade: Display Cases | 2,000 CR (+10% customer attraction) |
| Upgrade: Storage Room | 3,000 CR (+50% stock capacity) |
| Upgrade: Premium Signage | 1,500 CR (+5% customer attraction) |

**Mechanic:** Owner stocks the shop with items purchased from a wholesale catalog (NPC supplier). Customers browse and buy. If stock runs out, no revenue. Owner must manage restock frequency.

### 5.2 Restaurant / Bar

| Parameter | Value |
|-----------|-------|
| Purchase price | 20,000–72,000 CR |
| Ingredient cost per restock | 500–3,000 CR |
| Revenue per customer | 30–150 CR |
| NPC staff cost | 400 CR/week per cook, 300 CR/week per server |
| Upgrade: Kitchen Expansion | 5,000 CR (+30% menu items) |
| Upgrade: Patio Seating | 4,000 CR (+20% capacity) |
| Upgrade: Live Music Stage | 8,000 CR (+25% customer attraction) |

**Mechanic:** Operates like retail but with a menu system. Owner chooses which dishes/drinks to serve. Different items have different margins. Higher-tier ingredients cost more but attract more customers.

### 5.3 Nightclub / Venue

| Parameter | Value |
|-----------|-------|
| Purchase price | 40,000–100,000 CR |
| Operating cost | 1,000–3,000 CR/week |
| Cover charge | 20–100 CR per entry (owner sets) |
| Bar revenue per customer | 30–80 CR |
| NPC staff cost | 500 CR/week (DJ), 400 CR/week (bouncer), 300 CR/week (bartender) |
| Upgrade: VIP Section | 10,000 CR (premium entry at 3x cover) |
| Upgrade: Sound System | 7,000 CR (+15% attraction) |
| Upgrade: Light Show | 5,000 CR (+10% attraction) |

**Mechanic:** Revenue scales with player traffic. Owners can host events (costs CR to promote) that temporarily boost attraction. Peak hours (evening in-game time) generate 2x traffic.

### 5.4 Apartment Complex

| Parameter | Value |
|-----------|-------|
| Purchase price | 10,000–100,000 CR (by size) |
| Maintenance | Standard property maintenance |
| Rent per tenant per week | Set by owner (suggested: 3–8% of unit value) |
| Upgrade: Lobby Renovation | 3,000 CR (+10% desirability) |
| Upgrade: Security System | 2,000 CR (+5% desirability, -theft events) |
| Upgrade: Rooftop Access | 6,000 CR (unlocks premium unit) |

**Mechanic:** Owner sets rent. Tenants are other players who choose to rent instead of buy. Higher desirability = easier to fill vacancies. Empty units generate no income but still cost maintenance.

### 5.5 Garage / Workshop

| Parameter | Value |
|-----------|-------|
| Purchase price | 9,600–24,000 CR |
| Parts cost per restock | 300–1,500 CR |
| Revenue per service | 100–500 CR |
| NPC staff cost | 400 CR/week per mechanic |
| Upgrade: Paint Booth | 4,000 CR (unlocks cosmetic services) |
| Upgrade: Performance Bay | 6,000 CR (unlocks tuning services) |

**Mechanic:** Players bring vehicles for repair or customization. Owner sets service prices. Requires parts in stock.

### 5.6 Office Building

| Parameter | Value |
|-----------|-------|
| Purchase price | 25,000–75,000 CR |
| Maintenance | Standard |
| Lease per tenant per week | Set by owner |
| Upgrade: Conference Room | 3,000 CR (+10% lease value) |
| Upgrade: Executive Floor | 8,000 CR (premium lease tier) |

**Mechanic:** Players who lease office space get a buff to job income (+10–20% for white-collar jobs). This creates demand for office space as a utility, not just vanity.

### 5.7 Competition Dynamics

- **Proximity penalty:** Two identical businesses within the same block split customer traffic (each gets ~60% of what a solo business would get, not 50% — total market slightly expands).
- **Quality rating:** Businesses accumulate a 1–5 star rating based on stock availability, pricing fairness (compared to average), and upgrade level. Higher rating = more NPC foot traffic directed there.
- **Monopoly dampener:** If one player owns >3 businesses of the same type, each additional business of that type gets -10% revenue (stacks). Encourages diversification.

---

## 6. Anti-Exploit Measures

### 6.1 Inflation Control

- **Faucet cap:** Total CR entering the economy per server per day is soft-capped. If the daily faucet total exceeds the target (calculated as `active_players * 2,000 CR`), mission and job payouts scale down by up to 30%.
- **Dynamic sink tuning:** If the total money supply grows faster than 5% per week, maintenance costs and city taxes increase by 1 percentage point (up to a max of +5pp).
- **Wealth tax:** Players holding more than 5,000,000 CR in wallet lose 0.1% per week (500 CR minimum) to city coffers. This encourages investment over hoarding.

### 6.2 AFK Farming Prevention

- **Activity verification:** Job pay cycles require completing a simple interaction (click/move to a target). Missing the interaction = 0 pay for that cycle.
- **Idle detection:** Players idle for more than 10 minutes are flagged. After 20 minutes of no input, the player is disconnected. No passive income accrues.
- **Session earning cap:** A single session cannot earn more than 10,000 CR from jobs alone (resets on disconnect or after 4 hours, whichever is first). Missions and business revenue are exempt.
- **Velocity check:** If a player's balance increases by more than 50,000 CR in a single hour from non-business sources, flag for review.

### 6.3 Trade Exploit Prevention

- **Transaction cap:** 500,000 CR max per single trade.
- **New player restriction:** Accounts less than 48 hours old cannot send CR to other players (can receive).
- **Rapid trade detection:** More than 10 trades between the same two players within 1 hour triggers a flag.
- **Price floor/ceiling on Market Board:** Items cannot be listed for less than 10% or more than 500% of their base value. Prevents CR laundering via dummy item sales.

### 6.4 Multi-Account Prevention

- **IP tracking:** Flag accounts sharing an IP that trade heavily with each other.
- **Device fingerprint:** Browser fingerprinting to detect alt accounts.
- **Not automated bans** — flags go to a review queue. False positives (roommates, etc.) are expected.

---

## 7. Progression Curve

### 7.1 Target Timelines

These assume a player doing jobs and missions at a reasonable (not optimized) pace, spending some on personal items along the way.

| Milestone | Target Time | Approximate Net CR Needed |
|-----------|-------------|---------------------------|
| First clothing purchase | 15 minutes | 50 CR |
| First vehicle | 3–5 hours | 2,000 CR |
| First apartment (Residential, renting) | 1–2 hours | 200–400 CR (weekly rent) |
| First apartment (Residential, buying) | 4–6 hours | 2,000 CR |
| First small business (Industrial) | 10–15 hours | 6,400 CR + operating capital |
| Mid-tier property (Waterfront shop) | 25–40 hours | 12,000–22,500 CR |
| Downtown property | 50–80 hours | 16,000–60,000 CR |
| Nightclub (Entertainment) | 60–100 hours | 72,000+ CR |
| Penthouse (Downtown) | 100–150 hours | 100,000+ CR |
| Multi-property empire (5+ buildings) | 200+ hours | 250,000+ CR |

### 7.2 Earning Rate Benchmarks

| Phase | Typical Earning Rate | Primary Source |
|-------|---------------------|----------------|
| First hour | 300–500 CR/hr | Tutorial bonus + starter job |
| Hours 2–10 | 400–700 CR/hr | Jobs + missions |
| Hours 10–30 | 600–1,200 CR/hr | Better jobs + first business revenue |
| Hours 30–80 | 1,000–3,000 CR/hr | Multiple businesses + trading |
| Hours 80+ | 2,000–10,000 CR/hr | Business empire + high-value trades |

### 7.3 Design Intent

- **First session must feel rewarding.** The 500 CR starting balance plus the 200 CR tutorial payout means a new player can buy clothes and feel agency within 20 minutes.
- **First property is the hook.** Buying that first apartment or small shop should happen within the first few sessions (not the first 50 hours). This is the moment players feel ownership.
- **Mid-game is about choices.** Players should face interesting tradeoffs: save for a bigger property or upgrade the one they have? Diversify businesses or double down?
- **Late-game is about status and influence.** Owning a Downtown penthouse or a chain of businesses is a visible flex. The economy should make this achievable but not trivial.
- **No pay-to-win, no shortcuts.** Every CR is earned through play. This preserves the feeling that wealth is an accomplishment.

---

## 8. Server-Side Authority

All economy operations MUST be server-authoritative:

- **Balance mutations:** Only the Colyseus server can add/subtract CR from a player's wallet. The client sends intents ("I want to buy X"), the server validates and executes.
- **Price lookups:** Current property/item prices are computed server-side. The client displays cached values but the server enforces the real price at transaction time.
- **Transaction log:** Every CR movement is logged with timestamp, sender, receiver, amount, and type. This log is append-only and used for auditing and exploit detection.
- **Atomic transactions:** Buy/sell operations use database transactions. If any step fails, the entire operation rolls back.

---

## 9. Open Questions

1. **Monetization:** The GDD says credits are "earned, not purchased with real money initially." When/if real-money purchases are introduced, how does that interact with this economy? A cosmetics-only cash shop is safest for balance.
2. **Server population variance:** The economy assumes a healthy player count. What happens on a server with only 5 active players? Business revenue collapses. Should NPC customers exist as a floor? (Current design says no, but this may need revisiting.)
3. **Seasonal events:** Should there be seasonal economic events (holiday sales, market crashes, booms)? Could add dynamism but also unpredictability.
4. **Bankruptcy mechanic:** If a player loses all properties and has <100 CR, should there be a safety net (small loan, emergency job payout) or do they just grind back from zero?
5. **Inter-server economy:** If multiple server instances exist, are economies isolated or connected? Isolated is simpler and recommended for Phase 3.
