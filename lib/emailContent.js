// Shared transactional email content (subjects + HTML/text bodies).
// Imported by BOTH server.js (Render) and lib/email.js (Vercel serverless) so
// the two deploy paths always send identical copy. No transport here — callers
// own how the mail is actually sent.

// Public base URL of the site, used to build absolute RSVP links in emails.
const APP_URL = (process.env.APP_URL || 'https://embedded.devaarambh.com').replace(/\/$/, '');

const EVENT = {
  name: 'Embedded',
  date: 'Saturday, August 8, 2026',
  time: '9:00 AM - 6:00 PM',
  venue: 'Microsoft, Luxor North Tower, Bagmane Capital Campus, Mahadevapura, Bengaluru',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=Microsoft+Luxor+North+Tower+Bagmane+Capital+Campus+Mahadevapura+Bengaluru',
  discord: 'https://discord.gg/42k6bFFnKs',
};

const rsvpUrl = (token, intent) => `${APP_URL}/rsvp.html?token=${encodeURIComponent(token || '')}${intent ? '&intent=' + intent : ''}`;

const SUBJECTS = {
  pending: 'CraftifAI Embedded Hackathon registration has been received',
  approved: "You're In: CraftifAI Buildathon, August 8th at Microsoft, Bengaluru.",
  rsvp: 'Please confirm your spot: Embedded, August 8th at Microsoft, Bengaluru',
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstName = (r) => esc((r.fullName || 'there').split(' ')[0]);
const isPipe = (track) => /pipegen/i.test(track || '');
const isFirm = (track) => /firmgen/i.test(track || '');

// Clean, light, single-column transactional layout. Light bg + dark text renders
// consistently across clients and reads as professional (helps avoid spam heuristics).
// detailsHtml: pass a custom "event details" block, '' to omit it, or leave
// undefined for the default When/Where box.
function shell(preheader, badge, badgeColor, heading, bodyHtml, detailsHtml) {
  const detailsBlock = detailsHtml !== undefined ? detailsHtml : `
      <tr><td style="padding:6px 40px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border:1px solid #eef0f2;border-radius:8px">
          <tr><td style="padding:16px 18px;font-size:14px;color:#3a4655;line-height:1.7">
            <b style="color:#0f1b2d">When</b>&nbsp;&nbsp;${EVENT.date}, ${EVENT.time}<br>
            <b style="color:#0f1b2d">Where</b>&nbsp;&nbsp;${EVENT.venue}
          </td></tr>
        </table>
      </td></tr>`;
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
      </td></tr>${detailsBlock}
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
const label = (t) => `<div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#0f1b2d;margin:22px 0 10px">${esc(t)}</div>`;
const bullets = (items) => `<ul style="margin:0 0 15px;padding-left:20px;font-size:15px;line-height:1.7;color:#3a4655">`
  + items.map((it) => `<li style="margin:0 0 6px">${it}</li>`).join('') + `</ul>`;

/* ------------------------------- pending ------------------------------- */
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

/* ------------------------------ approved ------------------------------- */
// Track-specific copy blocks. Falls back to a generic build track when the
// registration has no recognised track.
function approvedCopy(track) {
  if (isPipe(track)) {
    return {
      trackName: 'PipeGen',
      intro: `You've been selected for the <b style="color:#0f1b2d">PipeGen</b> track. Here's what that means: you'll describe a vision system in plain English, and PipeGen will generate and deploy a production-ready perception pipeline on your NVIDIA GPU hardware. Object detection, tracking, depth sensing, segmentation, lane detection, or something nobody has tried before. You describe it. PipeGen builds it. You spend the rest of the day building something real on top of it.`,
      bring: [
        `<b style="color:#0f1b2d">Government-issued photo ID</b> (mandatory for entry, no exceptions)`,
        `<b style="color:#0f1b2d">Laptop</b> - Linux (Ubuntu) with NVIDIA GPU with driver version 560 or above`,
        `Minimum 50 GB free disk space`,
        `Charger`,
      ],
      bringNote: `This is mandatory. PipeGen runs on NVIDIA GPU hardware. If your laptop does not meet these specs, you will not be able to participate in this track. If you don't have access to a qualifying laptop, reply to this email and we can switch you to the FirmGen track instead.`,
      provided: [
        `Full Orbit platform access with credits`,
        `Mentors from CraftifAI's engineering team on the floor all day`,
        `Lunch and swags`,
      ],
      starter: `We will be sharing a starter package on Discord shortly. It includes the PipeGen installer, prerequisites setup script, and lab content to go through before the event. Install everything in advance. The first run takes extra time due to Docker image downloads, so do not leave this for the day of the event.`,
    };
  }
  // FirmGen (and generic fallback)
  return {
    trackName: isFirm(track) ? 'FirmGen' : (track || 'FirmGen'),
    intro: `You've been selected for the <b style="color:#0f1b2d">FirmGen</b> track. Here's what that means: you'll describe an IoT product in plain English, and FirmGen will design the architecture, generate the firmware, compile it, fix errors, and flash it onto a real ESP32 or STM32 board. The entire firmware development loop, handled by an AI agent. Your job is to pick a real problem, build a real product, and walk out with working firmware running on hardware.`,
    bring: [
      `<b style="color:#0f1b2d">Government-issued photo ID</b> (mandatory for entry, no exceptions)`,
      `<b style="color:#0f1b2d">Windows laptop</b> with charger`,
      `That's it. We provide the ESP32 and STM32 boards, sensors, and USB cables at the venue.`,
    ],
    bringNote: '',
    provided: [
      `ESP32 and STM32 hardware kits with sensors`,
      `Full Orbit platform access with credits`,
      `Mentors from CraftifAI's engineering team on the floor all day`,
      `Lunch and swags`,
    ],
    starter: `We will be sharing a starter package on Discord shortly. It includes the FirmGen tool to install and lab content to go through before the event. Install it in advance. Come prepared. You'll have limited time on the day and every minute counts.`,
  };
}

function eventDetailsHtml(c) {
  return `
      <tr><td style="padding:6px 40px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border:1px solid #eef0f2;border-radius:8px">
          <tr><td style="padding:16px 18px;font-size:14px;color:#3a4655;line-height:1.9">
            <b style="color:#0f1b2d">Event</b>&nbsp;&nbsp;Embedded - Hardware + AI Buildathon<br>
            <b style="color:#0f1b2d">Date</b>&nbsp;&nbsp;${EVENT.date}<br>
            <b style="color:#0f1b2d">Time</b>&nbsp;&nbsp;${EVENT.time}<br>
            <b style="color:#0f1b2d">Venue</b>&nbsp;&nbsp;${EVENT.venue} (<a href="${EVENT.mapUrl}" style="color:#1c6fd6;text-decoration:underline">Map</a>)<br>
            <b style="color:#0f1b2d">Track</b>&nbsp;&nbsp;${esc(c.trackName)}
          </td></tr>
        </table>
      </td></tr>`;
}

// Just the two RSVP action buttons (used by the standalone RSVP request email).
function rsvpButtonsHtml(reg) {
  if (!reg.rsvpToken) return '';
  return `<div style="margin:6px 0 4px">
    <a href="${rsvpUrl(reg.rsvpToken, 'yes')}" style="display:inline-block;background:#1c8a4e;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;margin:0 10px 10px 0">I'll be there</a>
    <a href="${rsvpUrl(reg.rsvpToken, 'no')}" style="display:inline-block;background:#ffffff;color:#b23c3c;border:1px solid #e2b3b3;font-size:15px;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:8px;margin:0 10px 10px 0">Can't make it</a>
  </div>`;
}

function discordButtonHtml() {
  return `<div style="margin:6px 0 4px">
    <a href="${EVENT.discord}" style="display:inline-block;background:#5865F2;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">Join Discord Now</a>
  </div>
  <p style="margin:10px 0 15px;font-size:13px;line-height:1.6;color:#6b7480">Or open this link: <a href="${EVENT.discord}" style="color:#1c6fd6">${EVENT.discord}</a></p>`;
}

function approvedEmail(reg) {
  const c = approvedCopy(reg.track);
  const body = para(`Hi ${firstName(reg)},`)
    + para(`You're in. Welcome to <b style="color:#0f1b2d">CraftifAI's Embedded</b> - Hardware + AI Buildathon.`)
    + para(c.intro)
    + para(`This is not a slideware competition. <b style="color:#0f1b2d">If it doesn't run, it doesn't count.</b>`)
    + label('What to Bring')
    + bullets(c.bring)
    + (c.bringNote ? para(c.bringNote) : '')
    + label("What's Provided")
    + bullets(c.provided)
    + label('Join Discord Now')
    + para(`All updates, support, and communication will happen on Discord. Join now so you don't miss anything.`)
    + discordButtonHtml()
    + para(c.starter)
    + para(`See you on August 8th.`)
    + para(`<b style="color:#0f1b2d">Team CraftifAI</b><br><a href="https://craftifai.com" style="color:#1c6fd6">craftifai.com</a>`);
  return shell(
    "You're in. Your seat for Embedded on August 8th is confirmed.",
    'Approved', '#1c8a4e', "You're In",
    body,
    eventDetailsHtml(c),
  );
}

function approvedText(reg) {
  const c = approvedCopy(reg.track);
  const strip = (s) => s.replace(/<[^>]+>/g, '');
  const lines = [];
  lines.push(`Hi ${(reg.fullName || 'there').split(' ')[0]},`, '');
  lines.push(`You're in. Welcome to CraftifAI's Embedded - Hardware + AI Buildathon.`, '');
  lines.push(strip(c.intro), '');
  lines.push(`This is not a slideware competition. If it doesn't run, it doesn't count.`, '');
  lines.push(`EVENT DETAILS`);
  lines.push(`Event: Embedded - Hardware + AI Buildathon`);
  lines.push(`Date: ${EVENT.date}`);
  lines.push(`Time: ${EVENT.time}`);
  lines.push(`Venue: ${EVENT.venue}`);
  lines.push(`Map: ${EVENT.mapUrl}`);
  lines.push(`Track: ${c.trackName}`, '');
  lines.push(`WHAT TO BRING`);
  c.bring.forEach((b) => lines.push(`- ${strip(b)}`));
  if (c.bringNote) { lines.push('', strip(c.bringNote)); }
  lines.push('');
  lines.push(`WHAT'S PROVIDED`);
  c.provided.forEach((p) => lines.push(`- ${strip(p)}`));
  lines.push('');
  lines.push(`JOIN DISCORD NOW`);
  lines.push(`All updates, support, and communication will happen on Discord. Join now so you don't miss anything:`);
  lines.push(EVENT.discord, '');
  lines.push(strip(c.starter), '');
  lines.push(`See you on August 8th.`, '');
  lines.push(`Team CraftifAI`, `craftifai.com`);
  return lines.join('\n');
}

/* --------------------------- RSVP request ------------------------------ */
// Standalone "are you coming?" email, sent to already-approved builders.
function rsvpRequestEmail(reg) {
  const c = approvedCopy(reg.track);
  const body = para(`Hi ${firstName(reg)},`)
    + para(`You're approved for <b style="color:#0f1b2d">Embedded</b> - Hardware + AI Buildathon on <b style="color:#0f1b2d">Saturday, August 8, 2026</b> at Microsoft, Bengaluru.`)
    + para(`Seats are limited, so please confirm whether you're coming. It takes one click and it's not binding, but it helps us plan hardware, food, and seating.`)
    + rsvpButtonsHtml(reg)
    + para(`If the buttons don't work, just reply to this email and let us know.`)
    + label('Join Discord')
    + para(`All updates, support, and communication happen on Discord. Join so you don't miss anything.`)
    + discordButtonHtml()
    + para(`<b style="color:#0f1b2d">Team CraftifAI</b><br><a href="https://craftifai.com" style="color:#1c6fd6">craftifai.com</a>`);
  return shell(
    'Please confirm your spot for Embedded on August 8th.',
    'RSVP', '#0a84ff', 'Are you coming?',
    body,
    eventDetailsHtml(c),
  );
}

function rsvpRequestText(reg) {
  const c = approvedCopy(reg.track);
  const lines = [];
  lines.push(`Hi ${(reg.fullName || 'there').split(' ')[0]},`, '');
  lines.push(`You're approved for Embedded - Hardware + AI Buildathon on Saturday, August 8, 2026 at Microsoft, Bengaluru.`, '');
  lines.push(`Seats are limited, so please confirm whether you're coming (one click, not binding):`);
  lines.push(`I'll be there: ${rsvpUrl(reg.rsvpToken, 'yes')}`);
  lines.push(`Can't make it: ${rsvpUrl(reg.rsvpToken, 'no')}`, '');
  lines.push(`EVENT DETAILS`);
  lines.push(`Date: ${EVENT.date}`);
  lines.push(`Time: ${EVENT.time}`);
  lines.push(`Venue: ${EVENT.venue}`);
  lines.push(`Map: ${EVENT.mapUrl}`);
  lines.push(`Track: ${c.trackName}`, '');
  lines.push(`If the buttons don't work, just reply to this email and let us know.`, '');
  lines.push(`JOIN DISCORD`);
  lines.push(`All updates, support, and communication happen on Discord. Join so you don't miss anything:`);
  lines.push(EVENT.discord, '');
  lines.push(`Team CraftifAI`, `craftifai.com`);
  return lines.join('\n');
}

module.exports = {
  EVENT, SUBJECTS,
  esc, firstName, shell, para,
  pendingEmail, pendingText, approvedEmail, approvedText,
  rsvpRequestEmail, rsvpRequestText,
};
