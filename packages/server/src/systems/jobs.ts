/**
 * Job System — Server-authoritative job framework for ThirdLife starter jobs.
 *
 * Design coords from world-map.md use (0-2000, 0-2000) with (0,0) at SW corner.
 * Babylon coords are centered: bx = designX - 1000, bz = designY - 1000.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobType = 'delivery' | 'cleaner' | 'security' | 'shop_assistant';

export interface Objective {
  type: 'goto' | 'interact' | 'wait';
  x: number;
  z: number;
  radius: number;
  duration?: number;   // for 'wait' type — seconds player must remain in radius
  completed: boolean;
}

export interface JobInstance {
  playerId: string;
  jobType: JobType;
  startTime: number;   // Date.now()
  timeLimit: number;    // seconds (0 = no hard timer, relies on idle timeout)
  objectives: Objective[];
  currentObjective: number;
  reward: number;       // total credits on completion (accumulated for multi-spot jobs)
  /** Per-objective payouts for jobs that pay per spot (cleaner, shop_assistant). */
  perObjectiveReward: number[];
  /** For shop_assistant 'wait' objectives — accumulated seconds inside zone. */
  waitProgress: number;
  /** Shift count completed so far (shop_assistant). */
  shiftsCompleted: number;
  /** Max shifts (shop_assistant). */
  maxShifts: number;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/** Convert design-doc coordinate to Babylon world coordinate. */
function toBabylon(designX: number, designY: number): { x: number; z: number } {
  return { x: designX - 1000, z: designY - 1000 };
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Location pools (design coords — converted at objective generation time)
// ---------------------------------------------------------------------------

interface LocationDef { name: string; x: number; y: number; district: string }

const DELIVERY_LOCATIONS: LocationDef[] = [
  { name: 'City Hall',            x: 1400, y: 800,  district: 'Downtown' },
  { name: 'Central Market',       x: 1350, y: 600,  district: 'Downtown' },
  { name: 'Community Center',     x: 600,  y: 1500, district: 'Residential' },
  { name: 'Sunrise Apartments',   x: 350,  y: 1300, district: 'Residential' },
  { name: 'Trade Depot',          x: 1300, y: 1400, district: 'Industrial' },
  { name: 'Haven Freight Yard',   x: 1500, y: 1800, district: 'Industrial' },
  { name: 'Fish Market',          x: 1500, y: 200,  district: 'Waterfront' },
  { name: 'Haven Marina',         x: 1700, y: 150,  district: 'Waterfront' },
  { name: 'Grand Stage',          x: 500,  y: 800,  district: 'Entertainment' },
  { name: 'Neon Alley Entrance',  x: 400,  y: 600,  district: 'Entertainment' },
];

const CLEANER_BOUNDS: Record<string, { minX: number; maxX: number; minY: number; maxY: number }> = {
  Residential: { minX: 200, maxX: 800, minY: 1200, maxY: 1800 },
  Downtown:    { minX: 1200, maxX: 1700, minY: 500, maxY: 900 },
};

const SECURITY_ROUTES: Record<string, LocationDef[]> = {
  Industrial: [
    { name: 'Freight Yard Gate',      x: 1500, y: 1800, district: 'Industrial' },
    { name: 'Trade Depot Loading Bay', x: 1300, y: 1400, district: 'Industrial' },
    { name: 'Scrapyard Perimeter',    x: 1700, y: 1500, district: 'Industrial' },
    { name: 'Power Plant Fence',      x: 1800, y: 1700, district: 'Industrial' },
  ],
  Waterfront: [
    { name: 'Marina Entrance',   x: 1700, y: 150, district: 'Waterfront' },
    { name: 'Boardwalk Midpoint', x: 1600, y: 100, district: 'Waterfront' },
    { name: 'Fish Market Rear',  x: 1500, y: 200, district: 'Waterfront' },
  ],
};

const SHOP_LOCATIONS: LocationDef[] = [
  { name: 'Central Market',  x: 1350, y: 600, district: 'Downtown' },
  { name: 'Grand Stage Vendor', x: 500, y: 800, district: 'Entertainment' },
];

// ---------------------------------------------------------------------------
// Active jobs store
// ---------------------------------------------------------------------------

const activeJobs = new Map<string, JobInstance>();
const cooldowns = new Map<string, Map<string, number>>(); // playerId -> jobType -> expiry timestamp

// ---------------------------------------------------------------------------
// Job generators
// ---------------------------------------------------------------------------

function generateDelivery(playerId: string): JobInstance {
  // Pick a random pickup, then a dropoff in a different district
  const pickup = pick(DELIVERY_LOCATIONS);
  const candidates = DELIVERY_LOCATIONS.filter(l => l.district !== pickup.district);
  const dropoff = pick(candidates);

  const p = toBabylon(pickup.x, pickup.y);
  const d = toBabylon(dropoff.x, dropoff.y);

  return {
    playerId,
    jobType: 'delivery',
    startTime: Date.now(),
    timeLimit: 120, // 2 minutes
    objectives: [
      { type: 'goto', x: p.x, z: p.z, radius: 3, completed: false },
      { type: 'goto', x: d.x, z: d.z, radius: 3, completed: false },
    ],
    currentObjective: 0,
    reward: 0,
    perObjectiveReward: [],
    waitProgress: 0,
    shiftsCompleted: 0,
    maxShifts: 1,
  };
}

function generateCleaner(playerId: string): JobInstance {
  const district = pick(Object.keys(CLEANER_BOUNDS));
  const bounds = CLEANER_BOUNDS[district];
  const spots: Objective[] = [];

  for (let i = 0; i < 5; i++) {
    const dx = randFloat(bounds.minX, bounds.maxX);
    const dy = randFloat(bounds.minY, bounds.maxY);
    const b = toBabylon(dx, dy);
    spots.push({ type: 'interact', x: b.x, z: b.z, radius: 2, completed: false });
  }

  // Roll per-spot rewards
  const perObjectiveReward = spots.map(() => randInt(30, 50));

  return {
    playerId,
    jobType: 'cleaner',
    startTime: Date.now(),
    timeLimit: 300, // 5 min idle timer (simplified to hard timer)
    objectives: spots,
    currentObjective: 0,
    reward: 0,
    perObjectiveReward,
    waitProgress: 0,
    shiftsCompleted: 0,
    maxShifts: 1,
  };
}

function generateSecurity(playerId: string): JobInstance {
  const route = pick(Object.keys(SECURITY_ROUTES));
  const checkpoints = SECURITY_ROUTES[route];

  const objectives: Objective[] = checkpoints.map(cp => {
    const b = toBabylon(cp.x, cp.y);
    return { type: 'goto' as const, x: b.x, z: b.z, radius: 3, completed: false };
  });

  return {
    playerId,
    jobType: 'security',
    startTime: Date.now(),
    timeLimit: 180, // 3 minutes
    objectives,
    currentObjective: 0,
    reward: 0,
    perObjectiveReward: [],
    waitProgress: 0,
    shiftsCompleted: 0,
    maxShifts: 1,
  };
}

function generateShopAssistant(playerId: string): JobInstance {
  const loc = pick(SHOP_LOCATIONS);
  const b = toBabylon(loc.x, loc.y);

  const shiftReward = randInt(40, 60);

  return {
    playerId,
    jobType: 'shop_assistant',
    startTime: Date.now(),
    timeLimit: 0, // no hard time limit; 60-sec away-from-zone auto-cancel handled in tick
    objectives: [
      { type: 'wait', x: b.x, z: b.z, radius: 5, duration: 30, completed: false },
    ],
    currentObjective: 0,
    reward: 0,
    perObjectiveReward: [shiftReward],
    waitProgress: 0,
    shiftsCompleted: 0,
    maxShifts: 3,
  };
}

const JOB_GENERATORS: Record<JobType, (playerId: string) => JobInstance> = {
  delivery: generateDelivery,
  cleaner: generateCleaner,
  security: generateSecurity,
  shop_assistant: generateShopAssistant,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const JOB_COOLDOWN_MS = 60_000; // 60 seconds

export function startJob(playerId: string, jobType: string): JobInstance | null {
  if (!isValidJobType(jobType)) return null;

  // Already has an active job — cancel it first (no partial payout)
  if (activeJobs.has(playerId)) {
    cancelJob(playerId);
  }

  // Check cooldown for this job type
  const playerCooldowns = cooldowns.get(playerId);
  if (playerCooldowns) {
    const expiry = playerCooldowns.get(jobType);
    if (expiry && Date.now() < expiry) return null; // still on cooldown
  }

  const job = JOB_GENERATORS[jobType](playerId);
  activeJobs.set(playerId, job);
  return job;
}

export function getActiveJob(playerId: string): JobInstance | null {
  return activeJobs.get(playerId) ?? null;
}

export function cancelJob(playerId: string): void {
  const job = activeJobs.get(playerId);
  if (job) {
    setCooldown(playerId, job.jobType);
    activeJobs.delete(playerId);
  }
}

/**
 * Check whether the player at (x, z) satisfies their current objective.
 * Returns status including whether a spot was completed and whether the whole job is done.
 */
export function checkObjective(
  playerId: string,
  x: number,
  z: number,
): { completed: boolean; jobDone: boolean; reward: number } {
  const job = activeJobs.get(playerId);
  if (!job) return { completed: false, jobDone: false, reward: 0 };

  const obj = job.objectives[job.currentObjective];
  if (!obj) return { completed: false, jobDone: false, reward: 0 };

  const dx = x - obj.x;
  const dz = z - obj.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // 'wait' objectives are handled separately via tickWaitProgress
  if (obj.type === 'wait') {
    return { completed: false, jobDone: false, reward: 0 };
  }

  if (dist > obj.radius) {
    return { completed: false, jobDone: false, reward: 0 };
  }

  // Player is within radius — complete this objective
  obj.completed = true;

  let spotReward = 0;

  if (job.jobType === 'cleaner') {
    spotReward = job.perObjectiveReward[job.currentObjective] ?? 0;
    job.reward += spotReward;
  }

  job.currentObjective++;

  // Check if all objectives are done
  if (job.currentObjective >= job.objectives.length) {
    return finishJob(job, spotReward);
  }

  return { completed: true, jobDone: false, reward: spotReward };
}

/**
 * Tick the wait-progress for shop_assistant jobs.
 * Call every server tick with deltaTime in seconds.
 * Returns completion info if the shift finishes.
 */
export function tickWaitProgress(
  playerId: string,
  x: number,
  z: number,
  dt: number,
): { shiftDone: boolean; jobDone: boolean; reward: number } | null {
  const job = activeJobs.get(playerId);
  if (!job || job.jobType !== 'shop_assistant') return null;

  const obj = job.objectives[job.currentObjective];
  if (!obj || obj.type !== 'wait') return null;

  const dx = x - obj.x;
  const dz = z - obj.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist <= obj.radius) {
    job.waitProgress += dt;

    if (job.waitProgress >= (obj.duration ?? 30)) {
      // Shift complete
      obj.completed = true;
      const shiftReward = job.perObjectiveReward[job.shiftsCompleted] ?? 0;
      job.reward += shiftReward;
      job.shiftsCompleted++;

      if (job.shiftsCompleted >= job.maxShifts) {
        // All shifts done
        const result = finishJob(job, 0);
        return { shiftDone: true, jobDone: result.jobDone, reward: job.reward };
      }

      // Prepare next shift
      job.waitProgress = 0;
      const nextReward = randInt(40, 60);
      job.perObjectiveReward.push(nextReward);
      // Reset objective for next shift
      obj.completed = false;

      return { shiftDone: true, jobDone: false, reward: shiftReward };
    }
  }

  return null; // still in progress, nothing to report
}

/**
 * Check whether a job's time limit has expired.
 * Returns true if the job was expired and removed.
 */
export function checkTimeExpired(playerId: string): boolean {
  const job = activeJobs.get(playerId);
  if (!job || job.timeLimit <= 0) return false;

  const elapsed = (Date.now() - job.startTime) / 1000;
  if (elapsed >= job.timeLimit) {
    cancelJob(playerId);
    return true;
  }
  return false;
}

/** Returns remaining seconds for an active job's time limit, or -1 if no limit. */
export function getRemainingTime(playerId: string): number {
  const job = activeJobs.get(playerId);
  if (!job) return 0;
  if (job.timeLimit <= 0) return -1;
  const elapsed = (Date.now() - job.startTime) / 1000;
  return Math.max(0, job.timeLimit - elapsed);
}

export function getJobBoard(): Array<{ type: string; description: string; reward: string }> {
  return [
    {
      type: 'delivery',
      description: 'Pick up a package and deliver it across districts. 2-minute time limit.',
      reward: '50-80 CR',
    },
    {
      type: 'cleaner',
      description: 'Clean 5 spots in the neighborhood. No rush, but stay in the area.',
      reward: '30-50 CR per spot (150-250 total)',
    },
    {
      type: 'security',
      description: 'Patrol 3-4 checkpoints in order. 3-minute time limit.',
      reward: '60-100 CR',
    },
    {
      type: 'shop_assistant',
      description: 'Stand near a shop counter for 30-second shifts. Up to 3 shifts.',
      reward: '40-60 CR per shift (up to 180 CR)',
    },
  ];
}

/** Get all player IDs with active jobs. */
export function getActiveJobPlayerIds(): string[] {
  return Array.from(activeJobs.keys());
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isValidJobType(type: string): type is JobType {
  return type === 'delivery' || type === 'cleaner' || type === 'security' || type === 'shop_assistant';
}

function setCooldown(playerId: string, jobType: string): void {
  if (!cooldowns.has(playerId)) {
    cooldowns.set(playerId, new Map());
  }
  cooldowns.get(playerId)!.set(jobType, Date.now() + JOB_COOLDOWN_MS);
}

function finishJob(job: JobInstance, lastSpotReward: number): { completed: boolean; jobDone: boolean; reward: number } {
  // Calculate final reward for delivery and security (time-bonus based)
  if (job.jobType === 'delivery') {
    const remaining = Math.max(0, job.timeLimit - (Date.now() - job.startTime) / 1000);
    const basePay = 50;
    const timeBonus = Math.floor((remaining / 120) * 30);
    job.reward = basePay + timeBonus;
  } else if (job.jobType === 'security') {
    const remaining = Math.max(0, job.timeLimit - (Date.now() - job.startTime) / 1000);
    const basePay = 60;
    const timeBonus = Math.floor((remaining / 180) * 40);
    job.reward = basePay + timeBonus;
  }

  const totalReward = job.reward;
  setCooldown(job.playerId, job.jobType);
  activeJobs.delete(job.playerId);

  return { completed: true, jobDone: true, reward: totalReward };
}
