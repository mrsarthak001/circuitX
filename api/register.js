// POST /api/register  (public)  -> create a registration + send "received" email
const { getPool, ensureTable, mapRow } = require('../lib/db');
const { isEmail, nonEmpty, clip } = require('../lib/util');
const { sendPending } = require('../lib/email');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
  const b = req.body || {};
  if (!nonEmpty(b.fullName)) return res.status(400).json({ ok: false, error: 'fullName required' });
  if (!isEmail(b.email)) return res.status(400).json({ ok: false, error: 'valid email required' });
  if (!nonEmpty(b.phone)) return res.status(400).json({ ok: false, error: 'phone required' });

  try {
    await ensureTable();
    const { rows } = await getPool().query(
      `INSERT INTO registrations (full_name,email,phone,role,college,company,designation,experience,linkedin,xurl,track)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [clip(b.fullName, 120), clip(b.email, 160), clip(b.phone, 40), clip(b.role, 40), clip(b.college, 160),
        clip(b.company, 160), clip(b.designation, 120), clip(b.experience, 40), clip(b.linkedin, 300), clip(b.xurl, 300), clip(b.track, 40)]
    );
    const reg = mapRow(rows[0]);
    await sendPending(reg); // await: serverless freezes after the response
    return res.status(201).json({ ok: true, id: reg.id, position: reg.position });
  } catch (e) {
    console.error('[register]', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
};
