// Shared Postgres access for the Vercel serverless functions (Supabase).
// A single Pool is reused across warm invocations. Use Supabase's *pooler*
// connection string (Transaction/Session mode) for serverless.
const { Pool } = require('pg');

const WAITLIST_BASE = Number.isFinite(Number(process.env.WAITLIST_BASE)) ? Number(process.env.WAITLIST_BASE) : 0;

let pool;
function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL || '';
    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(cs);
    pool = new Pool({
      connectionString: cs,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 1, // serverless: keep connections minimal
    });
  }
  return pool;
}

let tableReady;
function ensureTable() {
  if (!tableReady) {
    tableReady = getPool().query(`CREATE TABLE IF NOT EXISTS registrations (
      id          SERIAL PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      full_name   TEXT, email TEXT, phone TEXT, role TEXT, college TEXT,
      company     TEXT, designation TEXT, experience TEXT,
      linkedin    TEXT, xurl TEXT, track TEXT
    )`).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

function mapRow(r) {
  return {
    id: r.id,
    position: WAITLIST_BASE + r.id,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    fullName: r.full_name, email: r.email, phone: r.phone, role: r.role, college: r.college,
    company: r.company, designation: r.designation, experience: r.experience,
    linkedin: r.linkedin, xurl: r.xurl, track: r.track,
  };
}

module.exports = { getPool, ensureTable, mapRow, WAITLIST_BASE };
