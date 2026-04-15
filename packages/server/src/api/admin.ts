import { Router, Request, Response, NextFunction } from 'express';
import { getAllParcels, getAllPlayers, wipeParcels, deletePlayer, seedParcels } from '../db';

const router = Router();

// ── Basic-auth guard ──────────────────────────────────────────────────────
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // If no password configured, block entirely in prod; allow in dev.
    if (process.env.NODE_ENV === 'production') {
      res.status(503).send('Admin disabled (no ADMIN_PASSWORD set)');
      return;
    }
    next();
    return;
  }

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    const pw = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (pw === password) {
      next();
      return;
    }
  }
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

router.post('/api/ban/:id', (req, res) => {
  const id = req.params.id;
  const removed = deletePlayer(id);
  res.json({ ok: removed });
});

export default router;
