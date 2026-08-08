// POST /api/registrations/bulk-status  (admin)  { ids:[], status }
const { getPool, ensureTable, mapRow } = require('../../lib/db');
const { isAdmin } = require('../../lib/util');
const { sendApproved, sendVirtual } = require('../../lib/email');

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
    // Rows that actually change TO this status — used for one-time emails.
    const sel = await getPool().query(`SELECT * FROM registrations WHERE id IN (${inList}) AND status <> $1`, [status]);
    const transitioned = sel.rows.map(mapRow);
    const upd = await getPool().query(`UPDATE registrations SET status=$1, updated_at=now() WHERE id IN (${inList})`, [status]);
    // approve -> "You're In"; reject -> Virtual invite. await: serverless freezes after response.
    const mailer = status === 'approved' ? sendApproved : status === 'rejected' ? sendVirtual : null;
    if (mailer) { for (const r of transitioned) { await mailer(r); if (status === 'rejected') await getPool().query('UPDATE registrations SET virtual_invited=true WHERE id=$1', [r.id]); } }
    return res.status(200).json({ ok: true, count: upd.rowCount });
  } catch (e) {
    console.error('[bulk-status]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
