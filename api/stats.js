// GET /api/stats  (admin)  -> { total, by:{pending,approved,rejected} }
const { getPool, ensureTable } = require('../lib/db');
const { isAdmin } = require('../lib/util');

module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    await ensureTable();
    const { rows } = await getPool().query('SELECT status, count(*)::int AS n FROM registrations GROUP BY status');
    const by = { pending: 0, approved: 0, rejected: 0 };
    let total = 0;
    rows.forEach((r) => { by[r.status] = r.n; total += r.n; });
    return res.status(200).json({ ok: true, total, by });
  } catch (e) {
    console.error('[stats]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
