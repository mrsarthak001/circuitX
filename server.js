/*
 * Embedded backend — zero-dependency Node HTTP server.
 *
 * Responsibilities:
 *   - Serve the static site (index.html, register.html, dashboard.html, assets)
 *   - Persist registrations to data/registrations.json
 *   - Expose an admin API (list + approve/reject), guarded by an admin token
 *
 * Run:   ADMIN_TOKEN=your-secret node server.js
 * Env:   PORT (default 4600), ADMIN_TOKEN (required for admin API/dashboard —
 *        unset disables them with 503), WAITLIST_BASE (default 0 — positions start at #1)
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

// Minimal .env loader (no dependency). Real env vars take precedence.
(function loadEnv() {
  try {
    fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      if (m[1] in process.env) return;
      let v = m[2].trim();
      if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    });
  } catch (e) { /* no .env — fine */ }
})();
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');

const PORT = Number(process.env.PORT) || 4600;
// Admin token: no insecure default. If unset, all admin routes fail closed (503).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const WAITLIST_BASE = Number.isFinite(Number(process.env.WAITLIST_BASE)) ? Number(process.env.WAITLIST_BASE) : 0;

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Embedded <noreply@devaarambh.com>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

// Event details used in emails
const EVENT = {
  name: 'Embedded',
  date: 'Saturday, 08 August 2026',
  time: '9:00 AM – 6:30 PM',
  venue: 'Microsoft, Luxor North Tower, Bengaluru',
};

if (!ADMIN_TOKEN) {
  console.warn('[warn] ADMIN_TOKEN is not set — the admin API and dashboard are disabled (503) until you set it.');
}
if (!RESEND_API_KEY) {
  console.warn('[warn] RESEND_API_KEY not set — emails will be skipped (logged only).');
}

/* ----------------------------- data store -----------------------------
 * Storage is an async interface so the routes don't care which backend is
 * used. Postgres is used when DATABASE_URL is set; otherwise a JSON file
 * (data/registrations.json) is used for zero-setup local development.
 *   create(fields)           -> record
 *   list()                   -> [record] (newest first)
 *   stats()                  -> { total, by:{pending,approved,rejected} }
 *   setStatus(id, status)    -> { record, prev } | null
 *   bulkSetStatus(ids, s)    -> { count, approved:[record] }  (approved = newly-approved)
 * A record's `position` is derived as WAITLIST_BASE + id.
 * -------------------------------------------------------------------- */
const FIELDS = ['fullName', 'email', 'phone', 'role', 'college', 'company', 'designation', 'experience', 'linkedin', 'xurl', 'track'];

/* --- Postgres implementation --- */
function pgSsl(connString) {
  // Local connections: no TLS. Remote: verify the server cert when possible.
  // Provide DATABASE_CA_CERT (PEM) or DATABASE_SSL_STRICT=true to enforce verification.
  // Verification defaults off only because managed PG (Supabase/Render) often
  // presents chains Node won't validate without the provider CA.
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(connString)) return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) return { ca, rejectUnauthorized: true };
  if (process.env.DATABASE_SSL_STRICT === 'true') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function makePgStore(connString, PoolClass) {
  const Pool = PoolClass || require('pg').Pool;
  const pool = new Pool({ connectionString: connString, ssl: pgSsl(connString) });

  const map = (r) => ({
    id: r.id, position: WAITLIST_BASE + r.id, status: r.status,
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at),
    updatedAt: (r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at),
    fullName: r.full_name, email: r.email, phone: r.phone, role: r.role, college: r.college,
    company: r.company, designation: r.designation, experience: r.experience,
    linkedin: r.linkedin, xurl: r.xurl, track: r.track,
  });

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS registrations (
        id          SERIAL PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        full_name   TEXT, email TEXT, phone TEXT, role TEXT, college TEXT,
        company     TEXT, designation TEXT, experience TEXT,
        linkedin    TEXT, xurl TEXT, track TEXT
      )`);
    },
    async create(f) {
      const { rows } = await pool.query(
        `INSERT INTO registrations (full_name,email,phone,role,college,company,designation,experience,linkedin,xurl,track)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [f.fullName, f.email, f.phone, f.role, f.college, f.company, f.designation, f.experience, f.linkedin, f.xurl, f.track]
      );
      return map(rows[0]);
    },
    async list() {
      const { rows } = await pool.query('SELECT * FROM registrations ORDER BY id DESC');
      return rows.map(map);
    },
    async stats() {
      const { rows } = await pool.query('SELECT status, count(*)::int AS n FROM registrations GROUP BY status');
      const by = { pending: 0, approved: 0, rejected: 0 };
      let total = 0;
      rows.forEach((r) => { by[r.status] = r.n; total += r.n; });
      return { total, by };
    },
    async setStatus(id, status) {
      const cur = await pool.query('SELECT status FROM registrations WHERE id=$1', [id]);
      if (!cur.rows.length) return null;
      const prev = cur.rows[0].status;
      const { rows } = await pool.query(
        'UPDATE registrations SET status=$1, updated_at=now() WHERE id=$2 RETURNING *', [status, id]
      );
      return { record: map(rows[0]), prev };
    },
    async bulkSetStatus(ids, status) {
      // Coerce to a safe, inlined integer list (values are numbers only -> no injection).
      const safe = ids.filter((n) => Number.isInteger(n));
      if (!safe.length) return { count: 0, approved: [] };
      const inList = safe.join(',');
      let approved = [];
      if (status === 'approved') {
        const sel = await pool.query(`SELECT * FROM registrations WHERE id IN (${inList}) AND status <> 'approved'`);
        approved = sel.rows.map(map);
      }
      const upd = await pool.query(`UPDATE registrations SET status=$1, updated_at=now() WHERE id IN (${inList})`, [status]);
      return { count: upd.rowCount, approved };
    },
  };
}

/* --- JSON file implementation (fallback) --- */
function makeJsonStore() {
  let state;
  try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { state = { seq: 0, registrations: [] }; }
  const persist = () => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); };
  const withPos = (r) => Object.assign({}, r, { position: WAITLIST_BASE + r.id });

  return {
    kind: 'json',
    async init() { /* file created lazily on first write */ },
    async create(f) {
      state.seq += 1;
      const now = new Date().toISOString();
      const rec = { id: state.seq, status: 'pending', createdAt: now, updatedAt: now };
      FIELDS.forEach((k) => { rec[k] = f[k]; });
      state.registrations.push(rec);
      persist();
      return withPos(rec);
    },
    async list() { return state.registrations.slice().sort((a, b) => b.id - a.id).map(withPos); },
    async stats() {
      const by = { pending: 0, approved: 0, rejected: 0 };
      state.registrations.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
      return { total: state.registrations.length, by };
    },
    async setStatus(id, status) {
      const rec = state.registrations.find((r) => r.id === id);
      if (!rec) return null;
      const prev = rec.status;
      rec.status = status; rec.updatedAt = new Date().toISOString();
      persist();
      return { record: withPos(rec), prev };
    },
    async bulkSetStatus(ids, status) {
      const now = new Date().toISOString();
      const approved = [];
      let count = 0;
      state.registrations.forEach((r) => {
        if (ids.indexOf(r.id) > -1) {
          if (status === 'approved' && r.status !== 'approved') approved.push(withPos(r));
          r.status = status; r.updatedAt = now; count += 1;
        }
      });
      persist();
      return { count, approved };
    },
  };
}

const db = DATABASE_URL ? makePgStore(DATABASE_URL) : makeJsonStore();

/* ------------------------------ helpers ------------------------------- */
// Allowlist of servable static types. Deliberately excludes .js/.json and any
// server-side source so the static handler can never leak .env, source, or
// config. Everything the site needs is HTML (CSS/JS are inlined) plus a few
// text/image assets.
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('payload too large'));
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// timing-safe admin check. Fails closed when ADMIN_TOKEN is unset.
function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const token = req.headers['x-admin-token'] || '';
  const a = Buffer.from(String(token));
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* --------- lightweight in-memory rate limiter (per client IP) --------- */
const _rlBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = _rlBuckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; _rlBuckets.set(key, b); }
  b.count += 1;
  return b.count <= max;
}
// Evict stale buckets periodically so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of _rlBuckets) if (now > b.reset) _rlBuckets.delete(k);
}, 5 * 60 * 1000).unref();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const clip = (v, n = 300) => String(v == null ? '' : v).trim().slice(0, n);

/* ------------------------------- email -------------------------------- */
// Zero-dependency Resend send. Fire-and-forget; never blocks or throws.
function sendEmail(to, subject, html, text) {
  return new Promise((resolve) => {
    if (!RESEND_API_KEY) { console.log(`[mail] skipped (no key): "${subject}" -> ${to}`); return resolve({ skipped: true }); }
    const body = { from: MAIL_FROM, to: [to], subject, html, text };
    if (MAIL_REPLY_TO) body.reply_to = MAIL_REPLY_TO;
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; });
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) { console.log(`[mail] sent "${subject}" -> ${to}`); resolve({ ok: true }); }
        else { console.error(`[mail] failed (${r.statusCode}) "${subject}" -> ${to}: ${d}`); resolve({ ok: false, status: r.statusCode }); }
      });
    });
    req.on('error', (e) => { console.error(`[mail] error -> ${to}: ${e.message}`); resolve({ ok: false, error: e.message }); });
    req.write(payload); req.end();
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstName = (r) => esc((r.fullName || 'there').split(' ')[0]);

// Clean, light, single-column transactional layout. Light bg + dark text renders
// consistently across clients and reads as professional (helps avoid spam heuristics).
function shell(preheader, badge, badgeColor, heading, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;font-size:1px;line-height:1px">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr><td style="padding:24px 40px 18px;border-bottom:1px solid #eef0f2">
        <div style="font-size:20px;font-weight:700;letter-spacing:-.3px;color:#0f1b2d">Embedded</div>
        <div style="font-size:12px;color:#8b95a3;margin-top:3px">Hardware + AI Buildathon &middot; CraftifAI &times; DevAarambh</div>
      </td></tr>
      <tr><td style="padding:30px 40px 6px">
        <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${badgeColor};background:${badgeColor}14;border:1px solid ${badgeColor}55;border-radius:20px;padding:5px 12px;margin-bottom:16px">${esc(badge)}</span>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f1b2d;font-weight:700">${heading}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:6px 40px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border:1px solid #eef0f2;border-radius:8px">
          <tr><td style="padding:16px 18px;font-size:14px;color:#3a4655;line-height:1.7">
            <b style="color:#0f1b2d">When</b>&nbsp;&nbsp;${EVENT.date}, ${EVENT.time}<br>
            <b style="color:#0f1b2d">Where</b>&nbsp;&nbsp;${EVENT.venue}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 40px 26px;border-top:1px solid #eef0f2">
        <div style="font-size:12px;color:#98a1ae;line-height:1.7">
          You received this email because you registered for Embedded.<br>
          Embedded is organised by CraftifAI &times; DevAarambh &middot; Bengaluru, India.<br>
          Questions? Just reply to this email.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function para(t) { return `<p style="margin:0 0 15px;font-size:15px;line-height:1.65;color:#3a4655">${t}</p>`; }

function pendingEmail(reg) {
  const body = para(`Hi ${firstName(reg)},`)
    + para(`Thanks for signing up for <b style="color:#0f1b2d">Embedded</b>. We have received your registration and it is currently under review. We will email you as soon as your seat is confirmed.`)
    + (reg.track ? para(`Track you selected: <b style="color:#0f1b2d">${esc(reg.track)}</b>`) : '');
  return shell('We have received your Embedded registration and it is under review.',
    'Registration received', '#b6821c', 'Thanks for registering', body);
}
function pendingText(reg) {
  return `Hi ${(reg.fullName||'there').split(' ')[0]},\n\n`
    + `Thanks for signing up for Embedded. We have received your registration and it is currently under review. We will email you as soon as your seat is confirmed.\n\n`
    + (reg.track ? `Track you selected: ${reg.track}\n\n` : '')
    + `When: ${EVENT.date}, ${EVENT.time}\nWhere: ${EVENT.venue}\n\n`
    + `You received this email because you registered for Embedded.\nCraftifAI x DevAarambh, Bengaluru, India.`;
}

function approvedEmail(reg) {
  const kit = 'the hardware';
  const body = para(`Hi ${firstName(reg)},`)
    + para(`Good news: your registration for <b style="color:#0f1b2d">Embedded</b> has been approved and your seat is confirmed.`)
    + para(`You are in on the <b style="color:#0f1b2d">${esc(reg.track || 'build')}</b> track. We will provide ${kit} and mentors on the floor. Please bring your laptop and chargers.`)
    + para(`We look forward to seeing you on 8 August. Come ready to build.`);
  return shell('Your Embedded seat is confirmed. Full event details inside.',
    'Approved', '#1c8a4e', 'Your seat is confirmed', body);
}
function approvedText(reg) {
  const kit = 'the hardware';
  return `Hi ${(reg.fullName||'there').split(' ')[0]},\n\n`
    + `Good news: your registration for Embedded has been approved and your seat is confirmed.\n\n`
    + `You are in on the ${reg.track || 'build'} track. We will provide ${kit} and mentors on the floor. Please bring your laptop and chargers.\n\n`
    + `When: ${EVENT.date}, ${EVENT.time}\nWhere: ${EVENT.venue}\n\n`
    + `We look forward to seeing you on 8 August. Come ready to build.\n\n`
    + `CraftifAI x DevAarambh, Bengaluru, India.`;
}

function sendPending(reg) { sendEmail(reg.email, 'CraftifAI Embedded Hackathon registration has been received', pendingEmail(reg), pendingText(reg)); }
function sendApproved(reg) { sendEmail(reg.email, 'Your Embedded seat is confirmed', approvedEmail(reg), approvedText(reg)); }

/* ------------------------------- routes ------------------------------- */
async function handleApi(req, res, url) {
  const { pathname } = url;

  // Public: create a registration
  if (pathname === '/api/register' && req.method === 'POST') {
    // Rate limit: each accepted registration triggers an email to the supplied
    // address, so throttle per IP to prevent spam / email-bombing abuse.
    const ip = clientIp(req);
    if (!rateLimit(`reg:min:${ip}`, 5, 60 * 1000) || !rateLimit(`reg:hr:${ip}`, 30, 60 * 60 * 1000)) {
      return sendJSON(res, 429, { ok: false, error: 'Too many requests. Please try again in a little while.' });
    }
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }

    if (!nonEmpty(body.fullName)) return sendJSON(res, 400, { ok: false, error: 'fullName required' });
    if (!isEmail(body.email)) return sendJSON(res, 400, { ok: false, error: 'valid email required' });
    if (!nonEmpty(body.phone)) return sendJSON(res, 400, { ok: false, error: 'phone required' });

    const reg = await db.create({
      fullName: clip(body.fullName, 120),
      email: clip(body.email, 160),
      phone: clip(body.phone, 40),
      role: clip(body.role, 40),
      college: clip(body.college, 160),
      company: clip(body.company, 160),
      designation: clip(body.designation, 120),
      experience: clip(body.experience, 40),
      linkedin: clip(body.linkedin, 300),
      xurl: clip(body.xurl, 300),
      track: clip(body.track, 40),
    });
    sendPending(reg); // fire-and-forget: "registered, pending approval"
    return sendJSON(res, 201, { ok: true, id: reg.id, position: reg.position });
  }

  // Everything below is admin-only
  if (pathname.startsWith('/api/registrations') || pathname === '/api/stats') {
    if (!ADMIN_TOKEN) return sendJSON(res, 503, { ok: false, error: 'admin API not configured' });
    if (!isAdmin(req)) return sendJSON(res, 401, { ok: false, error: 'unauthorized' });
  }

  // Admin: quick auth ping (dashboard login)
  if (pathname === '/api/stats' && req.method === 'GET') {
    const s = await db.stats();
    return sendJSON(res, 200, { ok: true, total: s.total, by: s.by });
  }

  // Admin: list registrations (newest first)
  if (pathname === '/api/registrations' && req.method === 'GET') {
    const list = await db.list();
    return sendJSON(res, 200, { ok: true, registrations: list });
  }

  // Admin: bulk set status  POST /api/registrations/bulk-status  { ids:[], status }
  if (pathname === '/api/registrations/bulk-status' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    const status = String(body.status || '');
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return sendJSON(res, 400, { ok: false, error: 'status must be pending, approved or rejected' });
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    const { count, approved } = await db.bulkSetStatus(ids, status);
    approved.forEach(sendApproved); // approval emails for the newly-approved
    return sendJSON(res, 200, { ok: true, count });
  }

  // Admin: set status  POST /api/registrations/:id/status  { status }
  const m = pathname.match(/^\/api\/registrations\/(\d+)\/status$/);
  if (m && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    const status = String(body.status || '');
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return sendJSON(res, 400, { ok: false, error: 'status must be pending, approved or rejected' });
    }
    const result = await db.setStatus(Number(m[1]), status);
    if (!result) return sendJSON(res, 404, { ok: false, error: 'not found' });
    if (status === 'approved' && result.prev !== 'approved') sendApproved(result.record); // send once, on transition
    return sendJSON(res, 200, { ok: true, registration: result.record });
  }

  return sendJSON(res, 404, { ok: false, error: 'not found' });
}

/* --------------------------- static serving --------------------------- */
function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/') pathname = '/index.html';

  // Reject any dot-segment: blocks dotfiles/dirs (.env, .git, .vercel_token)
  // and traversal segments ("..") in one check.
  if (pathname.split('/').some((seg) => seg.startsWith('.'))) {
    res.writeHead(403); return res.end('Forbidden');
  }

  // Only serve allowlisted static types (excludes .js/.json/source/config).
  const ext = path.extname(pathname).toLowerCase();
  const type = STATIC_TYPES[ext];
  if (!type) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }

  const filePath = path.normalize(path.join(ROOT, pathname));
  // Must stay strictly inside ROOT (trailing sep prevents sibling-prefix escape,
  // e.g. ../CircuitX-private) and never touch data/.
  const inRoot = filePath === ROOT || filePath.startsWith(ROOT + path.sep);
  const inData = filePath === DATA_DIR || filePath.startsWith(DATA_DIR + path.sep);
  if (!inRoot || inData || filePath === __filename) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
}

/* ------------------------------- server ------------------------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => sendJSON(res, 500, { ok: false, error: e.message }));
  } else {
    serveStatic(req, res, url);
  }
});

function start() {
  return db.init().then(() => {
    server.listen(PORT, () => {
      console.log(`Embedded server running:  http://localhost:${PORT}`);
      console.log(`  Landing     ->  http://localhost:${PORT}/index.html`);
      console.log(`  Register    ->  http://localhost:${PORT}/register.html`);
      console.log(`  Dashboard   ->  http://localhost:${PORT}/dashboard.html`);
      console.log(`  Database    ->  ${db.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'JSON file (data/registrations.json) — set DATABASE_URL for Postgres'}`);
      console.log(`  Admin token ->  ${ADMIN_TOKEN ? '(set via ADMIN_TOKEN)' : 'NOT SET — admin API disabled (503)'}`);
      console.log(`  Email       ->  ${RESEND_API_KEY ? 'Resend enabled, from ' + MAIL_FROM : 'disabled (no RESEND_API_KEY)'}`);
    });
  }).catch((e) => {
    console.error('[fatal] database init failed:', e.message);
    process.exit(1);
  });
}

// Only auto-start when run directly (allows importing internals for tests).
if (require.main === module) start();

module.exports = { makePgStore, makeJsonStore };
