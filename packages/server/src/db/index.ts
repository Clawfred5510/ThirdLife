import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlayerRow {
  id: string;
  name: string;
  credits: number;
  reputation: number;
  x: number;
  y: number;
  z: number;
  last_login: string | null;
  tutorial_done: number;
}

export interface PropertyRow {
  id: number;
  building_name: string;
  district: string;
  owner_id: string | null;
  price: number;
  revenue_rate: number;
}

export interface ParcelRow {
  id: number;
  grid_x: number;
  grid_y: number;
  owner_id: string | null;
  business_name: string | null;
  business_type: string | null;
  color: string;
  height: number;
  claimed_at: string | null;
}

export interface BusinessUpdate {
  name?: string;
  type?: string;
  color?: string;
  height?: number;
}

// ── SQLite vs In-Memory fallback ───────────────────────────────────────────

interface DBBackend {
  getOrCreatePlayer(id: string, name: string): PlayerRow;
  savePlayerPosition(id: string, x: number, y: number, z: number): void;
  updatePlayerCredits(id: string, credits: number): void;
  getPlayerCredits(id: string): number;
  getProperties(): PropertyRow[];
  purchaseProperty(propertyId: number, playerId: string): boolean;
  getPlayerProperties(playerId: string): PropertyRow[];
  seedProperties(buildings: Array<{ name: string; district: string; price: number; revenue_rate: number }>): void;
  getPlayerTotalRevenue(playerId: string): number;
  isTutorialDone(playerId: string): boolean;
  markTutorialDone(playerId: string): void;
  seedParcels(): void;
  claimParcel(parcelId: number, playerId: string): boolean;
  updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean;
  getAllParcels(): ParcelRow[];
  getParcelOwner(parcelId: number): string | null;
}

// ── SQLite implementation ──────────────────────────────────────────────────

class SQLiteDatabase implements DBBackend {
  private db: any; // better-sqlite3 Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        credits INTEGER DEFAULT 500,
        reputation INTEGER DEFAULT 0,
        x REAL DEFAULT 400,
        y REAL DEFAULT 0,
        z REAL DEFAULT -200,
        last_login TEXT,
        tutorial_done INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        building_name TEXT NOT NULL,
        district TEXT NOT NULL,
        owner_id TEXT,
        price INTEGER NOT NULL,
        revenue_rate INTEGER DEFAULT 0,
        FOREIGN KEY (owner_id) REFERENCES players(id)
      );

      CREATE TABLE IF NOT EXISTS parcels (
        id INTEGER PRIMARY KEY,
        grid_x INTEGER NOT NULL,
        grid_y INTEGER NOT NULL,
        owner_id TEXT,
        business_name TEXT,
        business_type TEXT,
        color TEXT DEFAULT '#4a90d9',
        height REAL DEFAULT 4,
        claimed_at TEXT,
        FOREIGN KEY (owner_id) REFERENCES players(id)
      );
    `);

    // Safely add tutorial_done column for existing databases
    try {
      this.db.exec(`ALTER TABLE players ADD COLUMN tutorial_done INTEGER DEFAULT 0`);
    } catch (_) {
      // Column already exists — ignore
    }
  }

  private get stmtGetPlayer() { return this.db.prepare('SELECT * FROM players WHERE id = ?'); }
  private get stmtInsertPlayer() { return this.db.prepare(`INSERT INTO players (id, name, last_login) VALUES (?, ?, datetime('now'))`); }
  private get stmtUpdateLogin() { return this.db.prepare(`UPDATE players SET last_login = datetime('now') WHERE id = ?`); }
  private get stmtSavePosition() { return this.db.prepare('UPDATE players SET x = ?, y = ?, z = ? WHERE id = ?'); }
  private get stmtUpdateCredits() { return this.db.prepare('UPDATE players SET credits = ? WHERE id = ?'); }
  private get stmtGetCredits() { return this.db.prepare('SELECT credits FROM players WHERE id = ?'); }
  private get stmtGetProperties() { return this.db.prepare('SELECT * FROM properties'); }
  private get stmtGetProperty() { return this.db.prepare('SELECT * FROM properties WHERE id = ?'); }
  private get stmtSetPropertyOwner() { return this.db.prepare('UPDATE properties SET owner_id = ? WHERE id = ?'); }
  private get stmtGetPlayerProperties() { return this.db.prepare('SELECT * FROM properties WHERE owner_id = ?'); }
  private get stmtCountProperties() { return this.db.prepare('SELECT COUNT(*) AS cnt FROM properties'); }
  private get stmtInsertProperty() { return this.db.prepare('INSERT INTO properties (building_name, district, price, revenue_rate) VALUES (?, ?, ?, ?)'); }
  private get stmtGetPlayerTotalRevenue() { return this.db.prepare('SELECT COALESCE(SUM(revenue_rate), 0) AS total FROM properties WHERE owner_id = ?'); }
  private get stmtIsTutorialDone() { return this.db.prepare('SELECT tutorial_done FROM players WHERE id = ?'); }
  private get stmtMarkTutorialDone() { return this.db.prepare('UPDATE players SET tutorial_done = 1 WHERE id = ?'); }
  private get stmtCountParcels() { return this.db.prepare('SELECT COUNT(*) AS cnt FROM parcels'); }
  private get stmtInsertParcel() { return this.db.prepare('INSERT OR IGNORE INTO parcels (id, grid_x, grid_y) VALUES (?, ?, ?)'); }
  private get stmtGetParcel() { return this.db.prepare('SELECT * FROM parcels WHERE id = ?'); }
  private get stmtClaimParcel() { return this.db.prepare('UPDATE parcels SET owner_id = ?, claimed_at = datetime(\'now\') WHERE id = ? AND owner_id IS NULL'); }
  private get stmtUpdateBusiness() { return this.db.prepare('UPDATE parcels SET business_name = ?, business_type = ?, color = ?, height = ? WHERE id = ? AND owner_id = ?'); }

  getOrCreatePlayer(id: string, name: string): PlayerRow {
    let row = this.stmtGetPlayer.get(id) as PlayerRow | undefined;
    if (row) {
      this.stmtUpdateLogin.run(id);
      row.last_login = new Date().toISOString();
      return row;
    }
    this.stmtInsertPlayer.run(id, name);
    row = this.stmtGetPlayer.get(id) as PlayerRow;
    return row;
  }

  savePlayerPosition(id: string, x: number, y: number, z: number): void {
    this.stmtSavePosition.run(x, y, z, id);
  }

  updatePlayerCredits(id: string, credits: number): void {
    this.stmtUpdateCredits.run(credits, id);
  }

  getPlayerCredits(id: string): number {
    const row = this.stmtGetCredits.get(id) as { credits: number } | undefined;
    return row?.credits ?? 0;
  }

  getProperties(): PropertyRow[] {
    return this.stmtGetProperties.all() as PropertyRow[];
  }

  purchaseProperty(propertyId: number, playerId: string): boolean {
    const txn = this.db.transaction(() => {
      const property = this.stmtGetProperty.get(propertyId) as PropertyRow | undefined;
      if (!property || property.owner_id !== null) return false;
      const credits = this.getPlayerCredits(playerId);
      if (credits < property.price) return false;
      this.stmtUpdateCredits.run(credits - property.price, playerId);
      this.stmtSetPropertyOwner.run(playerId, propertyId);
      return true;
    });
    return txn();
  }

  getPlayerProperties(playerId: string): PropertyRow[] {
    return this.stmtGetPlayerProperties.all(playerId) as PropertyRow[];
  }

  seedProperties(buildings: Array<{ name: string; district: string; price: number; revenue_rate: number }>): void {
    const { cnt } = this.stmtCountProperties.get() as { cnt: number };
    if (cnt > 0) return;
    const insertMany = this.db.transaction(() => {
      for (const b of buildings) {
        this.stmtInsertProperty.run(b.name, b.district, b.price, b.revenue_rate);
      }
    });
    insertMany();
  }

  getPlayerTotalRevenue(playerId: string): number {
    const row = this.stmtGetPlayerTotalRevenue.get(playerId) as { total: number };
    return row.total;
  }

  isTutorialDone(playerId: string): boolean {
    const row = this.stmtIsTutorialDone.get(playerId) as { tutorial_done: number } | undefined;
    return (row?.tutorial_done ?? 0) === 1;
  }

  markTutorialDone(playerId: string): void {
    this.stmtMarkTutorialDone.run(playerId);
  }

  seedParcels(): void {
    const { cnt } = this.stmtCountParcels.get() as { cnt: number };
    if (cnt > 0) return;
    const GRID_SIZE = 50;
    const insertMany = this.db.transaction(() => {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        for (let gy = 0; gy < GRID_SIZE; gy++) {
          this.stmtInsertParcel.run(gx * GRID_SIZE + gy, gx, gy);
        }
      }
    });
    insertMany();
  }

  claimParcel(parcelId: number, playerId: string): boolean {
    const txn = this.db.transaction(() => {
      const parcel = this.stmtGetParcel.get(parcelId) as ParcelRow | undefined;
      if (!parcel || parcel.owner_id !== null) return false;
      const credits = this.getPlayerCredits(playerId);
      if (credits < 100) return false;
      this.stmtUpdateCredits.run(credits - 100, playerId);
      const result = this.stmtClaimParcel.run(playerId, parcelId);
      return result.changes > 0;
    });
    return txn();
  }

  updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean {
    const parcel = this.stmtGetParcel.get(parcelId) as ParcelRow | undefined;
    if (!parcel || parcel.owner_id !== playerId) return false;
    const name = data.name ?? parcel.business_name ?? '';
    const type = data.type ?? parcel.business_type ?? '';
    const color = data.color ?? parcel.color;
    const height = data.height ?? parcel.height;
    const result = this.stmtUpdateBusiness.run(name, type, color, height, parcelId, playerId);
    return result.changes > 0;
  }

  getAllParcels(): ParcelRow[] {
    return this.db.prepare('SELECT * FROM parcels').all() as ParcelRow[];
  }

  getParcelOwner(parcelId: number): string | null {
    const row = this.db.prepare('SELECT owner_id FROM parcels WHERE id = ?').get(parcelId) as { owner_id: string | null } | undefined;
    return row?.owner_id ?? null;
  }
}

// ── In-Memory Map-based fallback ───────────────────────────────────────────

class MemoryDB implements DBBackend {
  private players = new Map<string, PlayerRow>();
  private properties = new Map<number, PropertyRow>();
  private parcels = new Map<number, ParcelRow>();
  private nextPropertyId = 1;

  constructor() {
    console.log('[db] Using in-memory Map fallback (better-sqlite3 unavailable)');
  }

  getOrCreatePlayer(id: string, name: string): PlayerRow {
    let row = this.players.get(id);
    if (row) {
      row.last_login = new Date().toISOString();
      return row;
    }
    row = {
      id,
      name,
      credits: 500,
      reputation: 0,
      x: 400,
      y: 0,
      z: -200,
      last_login: new Date().toISOString(),
      tutorial_done: 0,
    };
    this.players.set(id, row);
    return row;
  }

  savePlayerPosition(id: string, x: number, y: number, z: number): void {
    const row = this.players.get(id);
    if (row) { row.x = x; row.y = y; row.z = z; }
  }

  updatePlayerCredits(id: string, credits: number): void {
    const row = this.players.get(id);
    if (row) row.credits = credits;
  }

  getPlayerCredits(id: string): number {
    return this.players.get(id)?.credits ?? 0;
  }

  getProperties(): PropertyRow[] {
    return Array.from(this.properties.values());
  }

  purchaseProperty(propertyId: number, playerId: string): boolean {
    const property = this.properties.get(propertyId);
    if (!property || property.owner_id !== null) return false;
    const credits = this.getPlayerCredits(playerId);
    if (credits < property.price) return false;
    this.updatePlayerCredits(playerId, credits - property.price);
    property.owner_id = playerId;
    return true;
  }

  getPlayerProperties(playerId: string): PropertyRow[] {
    return Array.from(this.properties.values()).filter(p => p.owner_id === playerId);
  }

  seedProperties(buildings: Array<{ name: string; district: string; price: number; revenue_rate: number }>): void {
    if (this.properties.size > 0) return;
    for (const b of buildings) {
      this.properties.set(this.nextPropertyId, {
        id: this.nextPropertyId,
        building_name: b.name,
        district: b.district,
        owner_id: null,
        price: b.price,
        revenue_rate: b.revenue_rate,
      });
      this.nextPropertyId++;
    }
  }

  getPlayerTotalRevenue(playerId: string): number {
    let total = 0;
    for (const p of this.properties.values()) {
      if (p.owner_id === playerId) total += p.revenue_rate;
    }
    return total;
  }

  isTutorialDone(playerId: string): boolean {
    return (this.players.get(playerId)?.tutorial_done ?? 0) === 1;
  }

  markTutorialDone(playerId: string): void {
    const row = this.players.get(playerId);
    if (row) row.tutorial_done = 1;
  }

  seedParcels(): void {
    if (this.parcels.size > 0) return;
    const GRID_SIZE = 50;
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        this.parcels.set(gx * GRID_SIZE + gy, {
          id: gx * GRID_SIZE + gy,
          grid_x: gx,
          grid_y: gy,
          owner_id: null,
          business_name: null,
          business_type: null,
          color: '#4a90d9',
          height: 4,
          claimed_at: null,
        });
      }
    }
  }

  claimParcel(parcelId: number, playerId: string): boolean {
    const parcel = this.parcels.get(parcelId);
    if (!parcel || parcel.owner_id !== null) return false;
    const credits = this.getPlayerCredits(playerId);
    if (credits < 100) return false;
    this.updatePlayerCredits(playerId, credits - 100);
    parcel.owner_id = playerId;
    parcel.claimed_at = new Date().toISOString();
    return true;
  }

  updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean {
    const parcel = this.parcels.get(parcelId);
    if (!parcel || parcel.owner_id !== playerId) return false;
    if (data.name !== undefined) parcel.business_name = data.name;
    if (data.type !== undefined) parcel.business_type = data.type;
    if (data.color !== undefined) parcel.color = data.color;
    if (data.height !== undefined) parcel.height = data.height;
    return true;
  }

  getAllParcels(): ParcelRow[] {
    return Array.from(this.parcels.values());
  }

  getParcelOwner(parcelId: number): string | null {
    return this.parcels.get(parcelId)?.owner_id ?? null;
  }
}

// ── Database initialisation ────────────────────────────────────────────────

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../../../../data/thirdlife.db');
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let backend: DBBackend;

try {
  backend = new SQLiteDatabase(DB_PATH);
  console.log('[db] Using SQLite backend');
} catch (err) {
  console.warn('[db] better-sqlite3 failed to load, falling back to in-memory Map:', (err as Error).message);
  backend = new MemoryDB();
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getOrCreatePlayer(id: string, name: string): PlayerRow {
  return backend.getOrCreatePlayer(id, name);
}

export function savePlayerPosition(id: string, x: number, y: number, z: number): void {
  backend.savePlayerPosition(id, x, y, z);
}

export function updatePlayerCredits(id: string, credits: number): void {
  backend.updatePlayerCredits(id, credits);
}

export function getPlayerCredits(id: string): number {
  return backend.getPlayerCredits(id);
}

export function getProperties(): PropertyRow[] {
  return backend.getProperties();
}

export function purchaseProperty(propertyId: number, playerId: string): boolean {
  return backend.purchaseProperty(propertyId, playerId);
}

export function getPlayerProperties(playerId: string): PropertyRow[] {
  return backend.getPlayerProperties(playerId);
}

export function seedProperties(
  buildings: Array<{ name: string; district: string; price: number; revenue_rate: number }>,
): void {
  backend.seedProperties(buildings);
}

export function getPlayerTotalRevenue(playerId: string): number {
  return backend.getPlayerTotalRevenue(playerId);
}

export function isTutorialDone(playerId: string): boolean {
  return backend.isTutorialDone(playerId);
}

export function markTutorialDone(playerId: string): void {
  backend.markTutorialDone(playerId);
}

export function seedParcels(): void {
  backend.seedParcels();
}

export function claimParcel(parcelId: number, playerId: string): boolean {
  return backend.claimParcel(parcelId, playerId);
}

export function updateBusiness(parcelId: number, playerId: string, data: BusinessUpdate): boolean {
  return backend.updateBusiness(parcelId, playerId, data);
}

export function getAllParcels(): ParcelRow[] {
  return backend.getAllParcels();
}

export function getParcelOwner(parcelId: number): string | null {
  return backend.getParcelOwner(parcelId);
}
