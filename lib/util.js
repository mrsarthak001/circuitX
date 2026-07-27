// Shared validation + admin auth for the serverless functions.
const crypto = require('crypto');

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const clip = (v, n = 300) => String(v == null ? '' : v).trim().slice(0, n);

// timing-safe admin token check (x-admin-token header vs ADMIN_TOKEN env).
// Fails closed when ADMIN_TOKEN is unset — no insecure default.
function isAdmin(req) {
  const want = process.env.ADMIN_TOKEN || '';
  if (!want) return false;
  const token = req.headers['x-admin-token'] || '';
  const a = Buffer.from(String(token));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isEmail, nonEmpty, clip, isAdmin };
