// Shared Postgres access for the Vercel serverless functions (Supabase).
// A single Pool is reused across warm invocations. Use Supabase's *pooler*
// connection string (Transaction/Session mode) for serverless.
const { Pool } = require('pg');
const crypto = require('crypto');

const WAITLIST_BASE = Number.isFinite(Number(process.env.WAITLIST_BASE)) ? Number(process.env.WAITLIST_BASE) : 0;

// Opaque, unguessable capability token that gates the public RSVP link.
const genToken = () => crypto.randomBytes(16).toString('hex');

function pgSsl(cs) {
  // Verify the DB server cert when possible. Set DATABASE_CA_CERT (PEM) or
  // DATABASE_SSL_STRICT=true to enforce; defaults off only because managed PG
  // often presents chains Node won't validate without the provider CA.
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(cs)) return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) return { ca, rejectUnauthorized: true };
  if (process.env.DATABASE_SSL_STRICT === 'true') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

let pool;
function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL || '';
    pool = new Pool({
      connectionString: cs,
      ssl: pgSsl(cs),
      max: 1, // serverless: keep connections minimal
    });
  }
  return pool;
}

let tableReady;
async function migrate() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS registrations (
    id          SERIAL PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    full_name   TEXT, email TEXT, phone TEXT, role TEXT, college TEXT,
    company     TEXT, designation TEXT, experience TEXT,
    linkedin    TEXT, xurl TEXT, track TEXT
  )`);
  // RSVP columns (added later — migrate in place, then backfill tokens).
  await pool.query(`ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS rsvp        TEXT,
    ADD COLUMN IF NOT EXISTS rsvp_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rsvp_token  TEXT`);
  const miss = await pool.query('SELECT id FROM registrations WHERE rsvp_token IS NULL');
  for (const r of miss.rows) {
    await pool.query('UPDATE registrations SET rsvp_token=$1 WHERE id=$2', [genToken(), r.id]);
  }
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS registrations_rsvp_token_idx ON registrations(rsvp_token)');
}
function ensureTable() {
  if (!tableReady) {
    tableReady = migrate().catch((e) => { tableReady = null; throw e; });
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
    rsvp: r.rsvp || null,
    rsvpAt: (r.rsvp_at instanceof Date ? r.rsvp_at.toISOString() : r.rsvp_at) || null,
    rsvpToken: r.rsvp_token || null,
  };
}

module.exports = { getPool, ensureTable, mapRow, genToken, WAITLIST_BASE };
