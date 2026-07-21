// POST /api/registrations/bulk-status  (admin)  { ids:[], status }
const { getPool, ensureTable, mapRow } = require('../../lib/db');
const { isAdmin } = require('../../lib/util');
const { sendApproved } = require('../../lib/email');

module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const b = req.body || {};
  const status = String(b.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be pending, approved or rejected' });
  }
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(200).json({ ok: true, count: 0 });
  const inList = ids.join(','); // sanitized integers only -> no injection

  try {
    await ensureTable();
    let approved = [];
    if (status === 'approved') {
      const sel = await getPool().query(`SELECT * FROM registrations WHERE id IN (${inList}) AND status <> 'approved'`);
      approved = sel.rows.map(mapRow);
    }
    const upd = await getPool().query(`UPDATE registrations SET status=$1, updated_at=now() WHERE id IN (${inList})`, [status]);
    for (const r of approved) { await sendApproved(r); } // await: serverless
    return res.status(200).json({ ok: true, count: upd.rowCount });
  } catch (e) {
    console.error('[bulk-status]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
