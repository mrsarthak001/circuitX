/*
 * Day-before reminder blast for Embedded.
 *
 *   (1) RSVP reminder  -> approved builders who have NOT responded (rsvp IS NULL)
 *   (2) Event reminder -> ALL approved builders
 *
 * Reads DATABASE_URL + RESEND_API_KEY from the environment (or .env). Sends are
 * throttled to stay under Resend's rate limit.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/send-reminders.js   # counts only, sends nothing
 *   node scripts/send-reminders.js             # actually sends
 *   ONLY=rsvp node scripts/send-reminders.js   # just the RSVP reminder
 *   ONLY=event node scripts/send-reminders.js  # just the event reminder
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Load .env (real env vars win), same rule as server.js.
(function loadEnv() {
  try {
    fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      if (m[1] in process.env) return;
      let v = m[2].trim();
      if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    });
  } catch (e) { /* no .env */ }
})();

const { makePgStore, makeJsonStore } = require('../server.js');
const { sendRsvpReminder, sendEventReminder } = require('../lib/email');

const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const ONLY = (process.env.ONLY || '').toLowerCase(); // '', 'rsvp', 'event'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = process.env.DATABASE_URL ? makePgStore(process.env.DATABASE_URL) : makeJsonStore();
  await db.init();
  const all = await db.list();
  const approved = all.filter((r) => r.status === 'approved' && r.email && r.rsvpToken);
  const nonResponders = approved.filter((r) => !r.rsvp); // no RSVP recorded yet

  console.log(`[reminders] ${DRY_RUN ? 'DRY RUN — ' : ''}approved=${approved.length}, non-responders=${nonResponders.length}`);
  console.log(`[reminders] RSVP reminder -> ${nonResponders.length} | Event reminder -> ${approved.length}`);

  if (DRY_RUN) {
    console.log('\nNon-responders (RSVP reminder):');
    nonResponders.forEach((r) => console.log(`  - ${r.fullName} <${r.email}> [${r.track || 'no track'}]`));
    console.log('\nAll approved (event reminder):');
    approved.forEach((r) => console.log(`  - ${r.fullName} <${r.email}> [${r.track || 'no track'}]`));
    console.log('\nDRY RUN complete — nothing sent.');
    process.exit(0);
  }

  let sent1 = 0, sent2 = 0;
  if (ONLY !== 'event') {
    for (const r of nonResponders) { await sendRsvpReminder(r); sent1 += 1; await sleep(220); }
  }
  if (ONLY !== 'rsvp') {
    for (const r of approved) { await sendEventReminder(r); sent2 += 1; await sleep(220); }
  }
  console.log(`[reminders] done — RSVP reminders sent=${sent1}, event reminders sent=${sent2}`);
  process.exit(0);
})().catch((e) => { console.error('[reminders] ERROR:', e.message); process.exit(1); });
