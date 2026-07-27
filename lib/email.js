// Resend email for the serverless functions. Uses global fetch (Node 18+).
// Awaitable so callers can await before the function freezes.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Embedded <noreply@devaarambh.com>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';

const EVENT = {
  date: 'Saturday, 08 August 2026',
  time: '9:00 AM to 6:30 PM',
  venue: 'Microsoft Office, Luxor North Tower, Bengaluru',
};

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

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstName = (r) => esc((r.fullName || 'there').split(' ')[0]);

function shell(preheader, badge, badgeColor, heading, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;font-size:1px;line-height:1px">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr><td style="padding:24px 40px 18px;border-bottom:1px solid #eef0f2">
        <div style="font-size:20px;font-weight:700;letter-spacing:-.3px;color:#0f1b2d">Embedded</div>
        <div style="font-size:12px;color:#8b95a3;margin-top:3px">Hardware + AI Buildathon &middot; CraftifAI &times; DevAarambh</div>
      </td></tr>
      <tr><td style="padding:30px 40px 6px">
        <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${badgeColor};background:${badgeColor}14;border:1px solid ${badgeColor}55;border-radius:20px;padding:5px 12px;margin-bottom:16px">${esc(badge)}</span>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f1b2d;font-weight:700">${heading}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:6px 40px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border:1px solid #eef0f2;border-radius:8px">
          <tr><td style="padding:16px 18px;font-size:14px;color:#3a4655;line-height:1.7">
            <b style="color:#0f1b2d">When</b>&nbsp;&nbsp;${EVENT.date}, ${EVENT.time}<br>
            <b style="color:#0f1b2d">Where</b>&nbsp;&nbsp;${EVENT.venue}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 40px 26px;border-top:1px solid #eef0f2">
        <div style="font-size:12px;color:#98a1ae;line-height:1.7">
          You received this email because you registered for Embedded.<br>
          Embedded is organised by CraftifAI &times; DevAarambh &middot; Bengaluru, India.<br>
          Questions? Just reply to this email.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const para = (t) => `<p style="margin:0 0 15px;font-size:15px;line-height:1.65;color:#3a4655">${t}</p>`;
const kitFor = () => 'the hardware';

function pendingEmail(reg) {
  const body = para(`Hi ${firstName(reg)},`)
    + para(`Thanks for signing up for <b style="color:#0f1b2d">Embedded</b>. We have received your registration and it is currently under review. We will email you as soon as your seat is confirmed.`)
    + (reg.track ? para(`Track you selected: <b style="color:#0f1b2d">${esc(reg.track)}</b>`) : '');
  return shell('We have received your Embedded registration and it is under review.',
    'Registration received', '#b6821c', 'Thanks for registering', body);
}
function pendingText(reg) {
  return `Hi ${(reg.fullName || 'there').split(' ')[0]},\n\n`
    + `Thanks for signing up for Embedded. We have received your registration and it is currently under review. We will email you as soon as your seat is confirmed.\n\n`
    + (reg.track ? `Track you selected: ${reg.track}\n\n` : '')
    + `When: ${EVENT.date}, ${EVENT.time}\nWhere: ${EVENT.venue}\n\n`
    + `You received this email because you registered for Embedded.\nCraftifAI x DevAarambh, Bengaluru, India.`;
}

function approvedEmail(reg) {
  const body = para(`Hi ${firstName(reg)},`)
    + para(`Good news: your registration for <b style="color:#0f1b2d">Embedded</b> has been approved and your seat is confirmed.`)
    + para(`You are in on the <b style="color:#0f1b2d">${esc(reg.track || 'build')}</b> track. We will provide ${kitFor(reg.track)} and mentors on the floor. Please bring your laptop and chargers.`)
    + para(`We look forward to seeing you on 8 August. Come ready to build.`);
  return shell('Your Embedded seat is confirmed. Full event details inside.',
    'Approved', '#1c8a4e', 'Your seat is confirmed', body);
}
function approvedText(reg) {
  return `Hi ${(reg.fullName || 'there').split(' ')[0]},\n\n`
    + `Good news: your registration for Embedded has been approved and your seat is confirmed.\n\n`
    + `You are in on the ${reg.track || 'build'} track. We will provide ${kitFor(reg.track)} and mentors on the floor. Please bring your laptop and chargers.\n\n`
    + `When: ${EVENT.date}, ${EVENT.time}\nWhere: ${EVENT.venue}\n\n`
    + `We look forward to seeing you on 8 August. Come ready to build.\n\n`
    + `CraftifAI x DevAarambh, Bengaluru, India.`;
}

const sendPending = (reg) => sendEmail(reg.email, 'CraftifAI Embedded Hackathon registration has been received', pendingEmail(reg), pendingText(reg));
const sendApproved = (reg) => sendEmail(reg.email, 'Your Embedded seat is confirmed', approvedEmail(reg), approvedText(reg));

module.exports = { sendPending, sendApproved };
