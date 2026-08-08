// /api/rsvp  (public) — RSVP via the emailed capability token.
//   GET  ?token=...            -> { firstName, track, status, rsvp }
//   POST { token, response }   -> records rsvp ('yes' | 'no')
// The token is the auth; there is no login.
const { getPool, ensureTable, mapRow } = require('../lib/db');

// Best-effort per-instance rate limit (serverless memory is per-warm-instance).
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
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async (req, res) => {
  try {
    await ensureTable();

    if (req.method === 'GET') {
      const token = String((req.query && req.query.token) || '');
      const virtual = (req.query && req.query.event) === 'virtual';
      if (!token) return res.status(404).json({ ok: false, error: 'invalid or expired link' });
      const { rows } = await getPool().query('SELECT * FROM registrations WHERE rsvp_token=$1', [token]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'invalid or expired link' });
      const rec = mapRow(rows[0]);
      return res.status(200).json({ ok: true, firstName: (rec.fullName || '').split(' ')[0], track: rec.track || '', status: rec.status, rsvp: virtual ? rec.virtualRsvp : rec.rsvp });
    }

    if (req.method === 'POST') {
      const ip = clientIp(req);
      if (!rateLimit(`rsvp:${ip}`, 30, 60 * 1000)) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again shortly.' });
      const b = req.body || {};
      const token = String(b.token || '');
      const response = String(b.response || '');
      const virtual = String(b.event || '') === 'virtual';
      if (!['yes', 'no'].includes(response)) return res.status(400).json({ ok: false, error: 'response must be yes or no' });
      const col = virtual ? 'virtual_rsvp' : 'rsvp';
      const atCol = virtual ? 'virtual_rsvp_at' : 'rsvp_at';
      const { rows } = await getPool().query(
        `UPDATE registrations SET ${col}=$1, ${atCol}=now(), updated_at=now() WHERE rsvp_token=$2 RETURNING *`,
        [response, token]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: 'invalid or expired link' });
      const rec = mapRow(rows[0]);
      return res.status(200).json({ ok: true, rsvp: virtual ? rec.virtualRsvp : rec.rsvp, firstName: (rec.fullName || '').split(' ')[0] });
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    console.error('[rsvp]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
