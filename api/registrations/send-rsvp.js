// POST /api/registrations/send-rsvp  (admin)
// Sends the standalone RSVP request email to every approved builder.
const { getPool, ensureTable, mapRow } = require('../../lib/db');
const { isAdmin } = require('../../lib/util');
const { sendRsvpRequest } = require('../../lib/email');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    await ensureTable();
    const { rows } = await getPool().query(
      "SELECT * FROM registrations WHERE status='approved' AND rsvp_token IS NOT NULL AND email IS NOT NULL ORDER BY id"
    );
    const recipients = rows.map(mapRow);
    // await sequentially so the sends complete within the invocation.
    for (const r of recipients) { await sendRsvpRequest(r); }
    return res.status(200).json({ ok: true, count: recipients.length });
  } catch (e) {
    console.error('[send-rsvp]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
