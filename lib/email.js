// Resend email for the serverless functions. Uses global fetch (Node 18+).
// Awaitable so callers can await before the function freezes.
// Copy lives in ./emailContent (shared with server.js so both deploy paths match).
const { SUBJECTS, pendingEmail, pendingText, approvedEmail, approvedText } = require('./emailContent');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Embedded <noreply@devaarambh.com>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || 'sarthak@devaarambh.com';

async function sendEmail(to, subject, html, text) {
  if (!RESEND_API_KEY) { console.log(`[mail] skipped (no key): "${subject}" -> ${to}`); return; }
  const body = { from: MAIL_FROM, to: [to], subject, html, text };
  if (MAIL_REPLY_TO) body.reply_to = MAIL_REPLY_TO;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error(`[mail] failed (${r.status}) "${subject}" -> ${to}: ${await r.text()}`);
    else console.log(`[mail] sent "${subject}" -> ${to}`);
  } catch (e) { console.error(`[mail] error -> ${to}: ${e.message}`); }
}

const sendPending = (reg) => sendEmail(reg.email, SUBJECTS.pending, pendingEmail(reg), pendingText(reg));
const sendApproved = (reg) => sendEmail(reg.email, SUBJECTS.approved, approvedEmail(reg), approvedText(reg));

module.exports = { sendPending, sendApproved };
