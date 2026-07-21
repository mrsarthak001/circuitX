// GET /api/registrations  (admin)  -> { registrations:[...] } (newest first)
const { getPool, ensureTable, mapRow } = require('../../lib/db');
const { isAdmin } = require('../../lib/util');

module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    await ensureTable();
    const { rows } = await getPool().query('SELECT * FROM registrations ORDER BY id DESC');
    return res.status(200).json({ ok: true, registrations: rows.map(mapRow) });
  } catch (e) {
    console.error('[list]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
