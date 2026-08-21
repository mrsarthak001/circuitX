// GET /api/verify?id=CERT_ID  (public) — certificate verification for the QR.
const { getPool, ensureTable } = require('../lib/db');

// Best-effort per-instance rate limit to blunt ID enumeration.
const _rl = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let e = _rl.get(key);
  if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; _rl.set(key, e); }
  e.count += 1;
  return e.count <= max;
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return xf ? String(xf).split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || 'unknown');
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method not allowed' });
  if (!rateLimit(`verify:${clientIp(req)}`, 40, 60 * 1000)) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again shortly.' });
  try {
    await ensureTable();
    const id = String((req.query && req.query.id) || '').trim();
    if (!id) return res.status(200).json({ ok: true, valid: false });
    const { rows } = await getPool().query('SELECT * FROM certificates WHERE cert_id=$1', [id]);
    if (!rows.length) return res.status(200).json({ ok: true, valid: false });
    const r = rows[0];
    return res.status(200).json({ ok: true, valid: true, name: r.name, event: r.event, track: r.track, issuedAt: (r.issued_at instanceof Date ? r.issued_at.toISOString() : r.issued_at) });
  } catch (e) {
    console.error('[verify]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
