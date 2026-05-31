import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { getAllParcels, getAllPlayers, wipeParcels, deletePlayer, seedParcels, wipePlayerParcels, getRawDb, playerExists } from '../db';

const router = Router();

// ── Brute-force lockout (per IP, in-process) ───────────────────────────────
// The admin surface is a single shared password gating destructive ops
// (wipe / ban / transfer-player). Lock an IP out after too many failures so
// the password can't be brute-forced online.
const LOCKOUT_THRESHOLD = 8;          // failures before lockout
const LOCKOUT_MS = 15 * 60_000;       // 15 min
const failCounts = new Map<string, { count: number; until: number }>();

function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

/** Constant-time string compare (avoids a timing oracle on the password). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Basic-auth guard ──────────────────────────────────────────────────────
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const password = process.env.ADMIN_PASSWORD;
  // Fail CLOSED: admin is disabled unless a password is configured, in EVERY
  // environment (previously dev fell open via next(), so an internet-reachable
  // non-prod instance with NODE_ENV unset exposed wipe/ban/transfer to anyone).
  if (!password) {
    res.status(503).send('Admin disabled (no ADMIN_PASSWORD set)');
    return;
  }

  const ip = clientIp(req);
  const now = Date.now();
  const rec = failCounts.get(ip);
  if (rec && rec.until > now) {
    res.status(429).send('Too many attempts. Try again later.');
    return;
  }

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    const pw = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (safeEqual(pw, password)) {
      failCounts.delete(ip); // reset on success
      next();
      return;
    }
  }
  // Record the failure + lock out once over threshold.
  const next_rec = rec && rec.until > now ? rec : { count: (rec?.count ?? 0), until: 0 };
  next_rec.count += 1;
  if (next_rec.count >= LOCKOUT_THRESHOLD) {
    next_rec.until = now + LOCKOUT_MS;
    next_rec.count = 0;
  }
  failCounts.set(ip, next_rec);
  res.setHeader('WWW-Authenticate', 'Basic realm="ThirdLife Admin", charset="UTF-8"');
  res.status(401).send('Authentication required.');
}

router.use(adminAuth);

// ── HTML admin page ───────────────────────────────────────────────────────
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<title>ThirdLife — Admin</title>
<style>
body{margin:0;padding:24px;background:#0a0a0f;color:#e4e4ef;font-family:system-ui,sans-serif}
h1{margin:0 0 6px;font-size:22px}
h2{margin:24px 0 8px;font-size:14px;text-transform:uppercase;color:#8b8b9a;letter-spacing:.05em}
.card{background:#12121a;border:1px solid #2a2a3a;border-radius:8px;padding:16px;margin-bottom:12px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.stat{background:#12121a;border:1px solid #2a2a3a;border-radius:8px;padding:12px 16px;flex:1;min-width:140px}
.stat .v{font-size:22px;font-weight:700;color:#a78bfa}
.stat .l{font-size:11px;color:#8b8b9a;text-transform:uppercase;letter-spacing:.05em}
button{background:#7c3aed;color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px}
button.danger{background:#dc2626}
button:hover{filter:brightness(1.1)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px;border-bottom:1px solid #2a2a3a;color:#8b8b9a;font-weight:500}
td{padding:8px;border-bottom:1px solid #1a1a26}
tr:hover td{background:#16161f}
.muted{color:#8b8b9a}
.ok{color:#22c55e}
.err{color:#ef4444}
#msg{position:fixed;top:16px;right:16px;padding:10px 14px;border-radius:6px;background:#16a34a;color:#fff;display:none}
</style></head>
<body>
<h1>🛠 ThirdLife Admin</h1>
<p class="muted">Operator-only controls. Links: <a href="/health" style="color:#a78bfa">/health</a> · <a href="/metrics" style="color:#a78bfa">/metrics</a></p>
<div id="msg"></div>

<div class="row">
  <div class="stat"><div class="v" id="sPlayers">…</div><div class="l">Total players</div></div>
  <div class="stat"><div class="v" id="sClaimed">…</div><div class="l">Parcels claimed</div></div>
  <div class="stat"><div class="v" id="sBiz">…</div><div class="l">Active businesses</div></div>
  <div class="stat"><div class="v" id="sUnclaimed">…</div><div class="l">Unclaimed parcels</div></div>
</div>

<div class="card">
  <h2>Dangerous actions</h2>
  <button class="danger" onclick="wipe()">Wipe World (reset all parcels)</button>
  <span class="muted" style="margin-left:8px">Drops every claim and business; players keep credits.</span>
</div>

<h2>Players</h2>
<div class="card"><table id="playerTbl"><thead><tr><th>Name</th><th>ID</th><th>Credits</th><th>Owned parcels</th><th>Actions</th></tr></thead><tbody></tbody></table></div>

<h2>Claimed parcels (first 200)</h2>
<div class="card"><table id="parcelTbl"><thead><tr><th>ID</th><th>Grid</th><th>Business</th><th>Type</th><th>Owner</th></tr></thead><tbody></tbody></table></div>

<script>
const msgEl = document.getElementById('msg');
function flash(text, err){
  msgEl.textContent = text;
  msgEl.style.background = err ? '#dc2626' : '#16a34a';
  msgEl.style.display = 'block';
  setTimeout(()=>{ msgEl.style.display='none'; }, 2500);
}

async function load() {
  const m = await fetch('/admin/api/snapshot').then(r=>r.json());
  document.getElementById('sPlayers').textContent = m.stats.players_total;
  document.getElementById('sClaimed').textContent = m.stats.parcels_claimed;
  document.getElementById('sBiz').textContent = m.stats.parcels_with_business;
  document.getElementById('sUnclaimed').textContent = m.stats.parcels_unclaimed;

  const ptb = document.querySelector('#playerTbl tbody');
  ptb.innerHTML = '';
  for (const p of m.players) {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td>\${escape(p.name)}</td>
      <td class="muted">\${escape(p.id)}</td>
      <td>\${p.credits}</td>
      <td>\${p.owned}</td>
      <td><button class="danger" onclick="ban('\${escape(p.id)}','\${escape(p.name)}')">Ban</button></td>
    \`;
    ptb.appendChild(tr);
  }

  const xtb = document.querySelector('#parcelTbl tbody');
  xtb.innerHTML = '';
  for (const p of m.claimed.slice(0, 200)) {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td>\${p.id}</td>
      <td class="muted">(\${p.grid_x},\${p.grid_y})</td>
      <td>\${escape(p.business_name || '—')}</td>
      <td>\${escape(p.business_type || '—')}</td>
      <td class="muted">\${escape(p.owner_id || '')}</td>
    \`;
    xtb.appendChild(tr);
  }
}

function escape(s){ return String(s).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\\'':'&#39;','"':'&quot;'}[c])); }

async function wipe(){
  if (!confirm('Wipe all parcels? This cannot be undone.')) return;
  const r = await fetch('/admin/api/wipe', { method: 'POST' });
  flash(r.ok ? 'World wiped.' : 'Wipe failed.', !r.ok);
  if (r.ok) load();
}

async function ban(id, name){
  if (!confirm('Ban and delete ' + name + '? Their owned parcels will be released.')) return;
  const r = await fetch('/admin/api/ban/' + encodeURIComponent(id), { method: 'POST' });
  flash(r.ok ? 'Player deleted.' : 'Delete failed.', !r.ok);
  if (r.ok) load();
}

load();
setInterval(load, 10000);
</script>
</body></html>
`;

router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(PAGE);
});

router.get('/api/snapshot', (_req, res) => {
  const parcels = getAllParcels();
  const players = getAllPlayers();
  const ownedByPlayer = new Map<string, number>();
  for (const p of parcels) {
    if (p.owner_id) {
      ownedByPlayer.set(p.owner_id, (ownedByPlayer.get(p.owner_id) ?? 0) + 1);
    }
  }

  const stats = {
    players_total: players.length,
    parcels_total: parcels.length,
    parcels_claimed: parcels.filter((p) => !!p.owner_id).length,
    parcels_with_business: parcels.filter((p) => !!p.business_name).length,
    parcels_unclaimed: parcels.filter((p) => !p.owner_id).length,
  };

  res.json({
    stats,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      owned: ownedByPlayer.get(p.id) ?? 0,
    })),
    claimed: parcels.filter((p) => !!p.owner_id),
  });
});

router.post('/api/wipe', (_req, res) => {
  wipeParcels();
  seedParcels();
  res.json({ ok: true });
});

// Scoped wipe: release only the parcels owned by `id`. Use this from QA
// tests to clean up after a test player without nuking real users' data.
// The full /api/wipe was used during QA earlier and accidentally deleted
// real claims (2026-04-27 incident). Always prefer the scoped version.
router.post('/api/wipe-player/:id', (req, res) => {
  const id = req.params.id;
  if (!id || id.length < 4) {
    res.status(400).json({ ok: false, error: 'invalid_id' });
    return;
  }
  const released = wipePlayerParcels(id);
  res.json({ ok: true, released });
});

router.post('/api/ban/:id', (req, res) => {
  const id = req.params.id;
  const removed = deletePlayer(id);
  res.json({ ok: removed });
});

// Move everything owned by `from` onto `to` in a single SQLite transaction.
// Used when a player who has been playing as a guest UUID connects a wallet
// for the first time and wants to keep their progress. Both player records
// must already exist.
//
// What moves: parcels, properties, market_orders, agents.owner_wallet (if
// `to` is a wallet), events.player_id, credits, food/materials/energy/luxury,
// reputation. Source ends with zero balance and no owned anything.
//
// Body: { from: string, to: string }
router.post('/api/transfer-player', (req: Request, res: Response) => {
  const { from, to } = (req.body ?? {}) as { from?: string; to?: string };
  if (typeof from !== 'string' || from.length < 4) {
    res.status(400).json({ ok: false, error: 'invalid_from' }); return;
  }
  if (typeof to !== 'string' || to.length < 4) {
    res.status(400).json({ ok: false, error: 'invalid_to' }); return;
  }
  if (from === to) {
    res.status(400).json({ ok: false, error: 'from_equals_to' }); return;
  }
  if (!playerExists(from)) {
    res.status(404).json({ ok: false, error: 'from_not_found' }); return;
  }
  if (!playerExists(to)) {
    res.status(404).json({ ok: false, error: 'to_not_found' }); return;
  }

  const db = getRawDb();
  const summary: Record<string, number> = {};
  const isToWallet = /^0x[a-fA-F0-9]{40}$/.test(to);

  const tx = db.transaction(() => {
    summary.parcels = (db.prepare('UPDATE parcels SET owner_id = ? WHERE owner_id = ?').run(to, from)).changes;

    // properties / market_orders / events / agents.owner_wallet — only run
    // if the table exists (additive migrations may not have applied yet on
    // an old DB shape).
    const hasTable = (name: string) => !!db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(name);

    if (hasTable('properties')) {
      summary.properties = db.prepare('UPDATE properties SET owner_id = ? WHERE owner_id = ?').run(to, from).changes;
    }
    if (hasTable('market_orders')) {
      summary.market_orders = db.prepare(`UPDATE market_orders SET owner_id = ? WHERE owner_id = ? AND status = 'open'`).run(to, from).changes;
    }
    summary.events = db.prepare('UPDATE events SET player_id = ? WHERE player_id = ?').run(to, from).changes;

    if (hasTable('agents')) {
      // If from was a wallet, agents may have owner_wallet = from; repoint
      // to the new wallet so the new wallet sees them in its My Agents tab.
      if (isToWallet) {
        summary.agent_ownership = db.prepare('UPDATE agents SET owner_wallet = ? WHERE owner_wallet = ?').run(to, from.toLowerCase()).changes;
      }
    }

    // Sum balances + resources from source onto target, then zero source.
    const fromRow = db.prepare('SELECT credits, reputation, food, materials, energy, luxury FROM players WHERE id = ?').get(from) as any;
    const toRow   = db.prepare('SELECT credits, reputation, food, materials, energy, luxury FROM players WHERE id = ?').get(to)   as any;

    const newTo = {
      credits:    (toRow.credits    ?? 0) + (fromRow.credits    ?? 0),
      reputation: (toRow.reputation ?? 0) + (fromRow.reputation ?? 0),
      food:       (toRow.food       ?? 0) + (fromRow.food       ?? 0),
      materials:  (toRow.materials  ?? 0) + (fromRow.materials  ?? 0),
      energy:     (toRow.energy     ?? 0) + (fromRow.energy     ?? 0),
      luxury:     (toRow.luxury     ?? 0) + (fromRow.luxury     ?? 0),
    };
    db.prepare(`UPDATE players SET credits=?, reputation=?, food=?, materials=?, energy=?, luxury=? WHERE id=?`)
      .run(newTo.credits, newTo.reputation, newTo.food, newTo.materials, newTo.energy, newTo.luxury, to);
    db.prepare(`UPDATE players SET credits=0, reputation=0, food=0, materials=0, energy=0, luxury=0 WHERE id=?`).run(from);

    summary.credits_moved    = fromRow.credits    ?? 0;
    summary.reputation_moved = fromRow.reputation ?? 0;
    summary.resources_moved  = (fromRow.food ?? 0) + (fromRow.materials ?? 0) + (fromRow.energy ?? 0) + (fromRow.luxury ?? 0);
  });

  try {
    tx();
    // eslint-disable-next-line no-console
    console.log(`[admin] transfer-player ${from} → ${to}:`, summary);
    res.json({ ok: true, from, to, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'transfer_failed', detail: (e as Error).message });
  }
});

export default router;
