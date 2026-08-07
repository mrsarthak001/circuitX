// POST /api/registrations/:id/status  (admin)  { status }
const { getPool, ensureTable, mapRow } = require('../../../lib/db');
const { isAdmin } = require('../../../lib/util');
const { sendApproved, sendVirtual } = require('../../../lib/email');

module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const b = req.body || {};
  const status = String(b.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be pending, approved or rejected' });
  }

  try {
    await ensureTable();
    const cur = await getPool().query('SELECT status FROM registrations WHERE id=$1', [id]);
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    const prev = cur.rows[0].status;
    const { rows } = await getPool().query(
      'UPDATE registrations SET status=$1, updated_at=now() WHERE id=$2 RETURNING *', [status, id]
    );
    const reg = mapRow(rows[0]);
    // await: serverless freezes after the response
    if (status === 'approved' && prev !== 'approved') await sendApproved(reg);
    else if (status === 'rejected' && prev !== 'rejected') await sendVirtual(reg);
    return res.status(200).json({ ok: true, registration: reg });
  } catch (e) {
    console.error('[status]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
