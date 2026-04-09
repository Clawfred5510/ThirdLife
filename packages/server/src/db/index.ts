import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

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
}

export interface PropertyRow {
  id: number;
  building_name: string;
  district: string;
  owner_id: string | null;
  price: number;
  revenue_rate: number;
}

// ── Database initialisation ────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '../../../../data');
const DB_PATH = path.resolve(DATA_DIR, 'thirdlife.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    credits INTEGER DEFAULT 500,
    reputation INTEGER DEFAULT 0,
    x REAL DEFAULT 400,
    y REAL DEFAULT 0,
    z REAL DEFAULT -200,
    last_login TEXT
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
`);

// ── Prepared statements ────────────────────────────────────────────────────

const stmtGetPlayer = db.prepare<[string]>('SELECT * FROM players WHERE id = ?');

const stmtInsertPlayer = db.prepare<[string, string]>(
  `INSERT INTO players (id, name, last_login) VALUES (?, ?, datetime('now')) RETURNING *`,
);

const stmtUpdateLogin = db.prepare<[string]>(
  `UPDATE players SET last_login = datetime('now') WHERE id = ?`,
);

const stmtSavePosition = db.prepare<[number, number, number, string]>(
  'UPDATE players SET x = ?, y = ?, z = ? WHERE id = ?',
);

const stmtUpdateCredits = db.prepare<[number, string]>(
  'UPDATE players SET credits = ? WHERE id = ?',
);

const stmtGetCredits = db.prepare<[string]>('SELECT credits FROM players WHERE id = ?');

const stmtGetProperties = db.prepare('SELECT * FROM properties');

const stmtGetProperty = db.prepare<[number]>('SELECT * FROM properties WHERE id = ?');

const stmtSetPropertyOwner = db.prepare<[string, number]>(
  'UPDATE properties SET owner_id = ? WHERE id = ?',
);

const stmtGetPlayerProperties = db.prepare<[string]>(
  'SELECT * FROM properties WHERE owner_id = ?',
);

const stmtCountProperties = db.prepare('SELECT COUNT(*) AS cnt FROM properties');

const stmtInsertProperty = db.prepare<[string, string, number]>(
  'INSERT INTO properties (building_name, district, price) VALUES (?, ?, ?)',
);

// ── Public API ─────────────────────────────────────────────────────────────

export function getOrCreatePlayer(id: string, name: string): PlayerRow {
  let row = stmtGetPlayer.get(id) as PlayerRow | undefined;
  if (row) {
    stmtUpdateLogin.run(id);
    row.last_login = new Date().toISOString();
    return row;
  }
  row = stmtInsertPlayer.get(id, name) as PlayerRow;
  return row;
}

export function savePlayerPosition(id: string, x: number, y: number, z: number): void {
  stmtSavePosition.run(x, y, z, id);
}

export function updatePlayerCredits(id: string, credits: number): void {
  stmtUpdateCredits.run(credits, id);
}

export function getPlayerCredits(id: string): number {
  const row = stmtGetCredits.get(id) as { credits: number } | undefined;
  return row?.credits ?? 0;
}

export function getProperties(): PropertyRow[] {
  return stmtGetProperties.all() as PropertyRow[];
}

export function purchaseProperty(propertyId: number, playerId: string): boolean {
  const txn = db.transaction(() => {
    const property = stmtGetProperty.get(propertyId) as PropertyRow | undefined;
    if (!property || property.owner_id !== null) return false;

    const credits = getPlayerCredits(playerId);
    if (credits < property.price) return false;

    stmtUpdateCredits.run(credits - property.price, playerId);
    stmtSetPropertyOwner.run(playerId, propertyId);
    return true;
  });
  return txn();
}

export function getPlayerProperties(playerId: string): PropertyRow[] {
  return stmtGetPlayerProperties.all(playerId) as PropertyRow[];
}

export function seedProperties(
  buildings: Array<{ name: string; district: string; price: number }>,
): void {
  const { cnt } = stmtCountProperties.get() as { cnt: number };
  if (cnt > 0) return; // already seeded

  const insertMany = db.transaction(() => {
    for (const b of buildings) {
      stmtInsertProperty.run(b.name, b.district, b.price);
    }
  });
  insertMany();
}

export default db;
