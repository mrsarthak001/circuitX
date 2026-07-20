/*
 * CircuitX backend — zero-dependency Node HTTP server.
 *
 * Responsibilities:
 *   - Serve the static site (index.html, register.html, dashboard.html, assets)
 *   - Persist registrations to data/registrations.json
 *   - Expose an admin API (list + approve/reject), guarded by an admin token
 *
 * Run:   ADMIN_TOKEN=your-secret node server.js
 * Env:   PORT (default 4600), ADMIN_TOKEN (default "circuitx-admin"),
 *        WAITLIST_BASE (default 0 — positions start at #1)
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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'circuitx-admin';
const WAITLIST_BASE = Number.isFinite(Number(process.env.WAITLIST_BASE)) ? Number(process.env.WAITLIST_BASE) : 0;

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'CircuitX <onboarding@resend.dev>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';

// Event details used in emails
const EVENT = {
  name: 'CircuitX',
  date: 'Saturday, 08 August 2026',
  time: '9:00 AM – 6:00 PM',
  venue: 'Microsoft, Luxor North Tower, Bengaluru',
};

if (ADMIN_TOKEN === 'circuitx-admin') {
  console.warn('[warn] Using the default ADMIN_TOKEN "circuitx-admin". Set ADMIN_TOKEN to a secret before deploying.');
}
if (!RESEND_API_KEY) {
  console.warn('[warn] RESEND_API_KEY not set — emails will be skipped (logged only).');
}

/* ----------------------------- data store ----------------------------- */
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { seq: 0, registrations: [] };
  }
}
function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
let store = loadData();

/* ------------------------------ helpers ------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
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

// timing-safe admin check
function isAdmin(req) {
  const token = req.headers['x-admin-token'] || '';
  const a = Buffer.from(String(token));
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
        <div style="font-size:20px;font-weight:700;letter-spacing:-.3px;color:#0f1b2d">Circuit<span style="color:#0e7d8c">X</span></div>
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
          You received this email because you registered for CircuitX.<br>
          CircuitX is organised by CraftifAI &times; DevAarambh &middot; Bengaluru, India.<br>
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
    + para(`Thanks for signing up for <b style="color:#0f1b2d">CircuitX</b>. We have received your registration and it is currently under review. We will email you as soon as your seat is confirmed.`)
    + (reg.track ? para(`Track you selected: <b style="color:#0f1b2d">${esc(reg.track)}</b>`) : '');
  return shell('We have received your CircuitX registration and it is under review.',
    'Registration received', '#b6821c', 'Thanks for registering', body);
}
function pendingText(reg) {
  return `Hi ${(reg.fullName||'there').split(' ')[0]},\n\n`
    + `Thanks for signing up for CircuitX. We have received your registration and it is currently under review. We will email you as soon as your seat is confirmed.\n\n`
    + (reg.track ? `Track you selected: ${reg.track}\n\n` : '')
    + `When: ${EVENT.date}, ${EVENT.time}\nWhere: ${EVENT.venue}\n\n`
    + `You received this email because you registered for CircuitX.\nCraftifAI x DevAarambh, Bengaluru, India.`;
}

function approvedEmail(reg) {
  const kit = reg.track === 'FirmGen' ? 'ESP32 and STM32 boards' : reg.track === 'PipeGen' ? 'a perception rig' : 'your hardware kit';
  const body = para(`Hi ${firstName(reg)},`)
    + para(`Good news: your registration for <b style="color:#0f1b2d">CircuitX</b> has been approved and your seat is confirmed.`)
    + para(`You are in on the <b style="color:#0f1b2d">${esc(reg.track || 'build')}</b> track. We will provide ${kit} and mentors on the floor. Please bring your laptop and chargers.`)
    + para(`We look forward to seeing you on 8 August. Come ready to build.`);
  return shell('Your CircuitX seat is confirmed. Full event details inside.',
    'Approved', '#1c8a4e', 'Your seat is confirmed', body);
}
function approvedText(reg) {
  const kit = reg.track === 'FirmGen' ? 'ESP32 and STM32 boards' : reg.track === 'PipeGen' ? 'a perception rig' : 'your hardware kit';
  return `Hi ${(reg.fullName||'there').split(' ')[0]},\n\n`
    + `Good news: your registration for CircuitX has been approved and your seat is confirmed.\n\n`
    + `You are in on the ${reg.track || 'build'} track. We will provide ${kit} and mentors on the floor. Please bring your laptop and chargers.\n\n`
    + `When: ${EVENT.date}, ${EVENT.time}\nWhere: ${EVENT.venue}\n\n`
    + `We look forward to seeing you on 8 August. Come ready to build.\n\n`
    + `CraftifAI x DevAarambh, Bengaluru, India.`;
}

function sendPending(reg) { sendEmail(reg.email, 'Your CircuitX registration has been received', pendingEmail(reg), pendingText(reg)); }
function sendApproved(reg) { sendEmail(reg.email, 'Your CircuitX seat is confirmed', approvedEmail(reg), approvedText(reg)); }

/* ------------------------------- routes ------------------------------- */
async function handleApi(req, res, url) {
  const { pathname } = url;

  // Public: create a registration
  if (pathname === '/api/register' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }

    if (!nonEmpty(body.fullName)) return sendJSON(res, 400, { ok: false, error: 'fullName required' });
    if (!isEmail(body.email)) return sendJSON(res, 400, { ok: false, error: 'valid email required' });
    if (!nonEmpty(body.phone)) return sendJSON(res, 400, { ok: false, error: 'phone required' });

    store.seq += 1;
    const now = new Date().toISOString();
    const reg = {
      id: store.seq,
      position: WAITLIST_BASE + store.seq,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
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
    };
    store.registrations.push(reg);
    saveData(store);
    sendPending(reg); // fire-and-forget: "registered, pending approval"
    return sendJSON(res, 201, { ok: true, id: reg.id, position: reg.position });
  }

  // Everything below is admin-only
  if (pathname.startsWith('/api/registrations') || pathname === '/api/stats') {
    if (!isAdmin(req)) return sendJSON(res, 401, { ok: false, error: 'unauthorized' });
  }

  // Admin: quick auth ping (dashboard login)
  if (pathname === '/api/stats' && req.method === 'GET') {
    const by = { pending: 0, approved: 0, rejected: 0 };
    store.registrations.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
    return sendJSON(res, 200, { ok: true, total: store.registrations.length, by });
  }

  // Admin: list registrations (newest first)
  if (pathname === '/api/registrations' && req.method === 'GET') {
    const list = store.registrations.slice().sort((a, b) => b.id - a.id);
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
    const now = new Date().toISOString();
    let count = 0;
    const toEmail = [];
    store.registrations.forEach((r) => {
      if (ids.indexOf(r.id) > -1) {
        if (status === 'approved' && r.status !== 'approved') toEmail.push(r);
        r.status = status; r.updatedAt = now; count += 1;
      }
    });
    saveData(store);
    toEmail.forEach(sendApproved); // approval emails for the newly-approved
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
    const reg = store.registrations.find((r) => r.id === Number(m[1]));
    if (!reg) return sendJSON(res, 404, { ok: false, error: 'not found' });
    const prev = reg.status;
    reg.status = status;
    reg.updatedAt = new Date().toISOString();
    saveData(store);
    if (status === 'approved' && prev !== 'approved') sendApproved(reg); // send once, on transition
    return sendJSON(res, 200, { ok: true, registration: reg });
  }

  return sendJSON(res, 404, { ok: false, error: 'not found' });
}

/* --------------------------- static serving --------------------------- */
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));

  // prevent path traversal + never serve data/ or server.js
  if (!filePath.startsWith(ROOT) || filePath === __filename || filePath.startsWith(DATA_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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

server.listen(PORT, () => {
  console.log(`CircuitX server running:  http://localhost:${PORT}`);
  console.log(`  Landing     ->  http://localhost:${PORT}/index.html`);
  console.log(`  Register    ->  http://localhost:${PORT}/register.html`);
  console.log(`  Dashboard   ->  http://localhost:${PORT}/dashboard.html`);
  console.log(`  Admin token ->  ${ADMIN_TOKEN === 'circuitx-admin' ? 'circuitx-admin (default — change it!)' : '(set via ADMIN_TOKEN)'}`);
  console.log(`  Email       ->  ${RESEND_API_KEY ? 'Resend enabled, from ' + MAIL_FROM : 'disabled (no RESEND_API_KEY)'}`);
});
