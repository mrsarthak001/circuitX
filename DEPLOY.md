# Deploying CircuitX

There are two supported ways to run this. The DB is always Supabase (Postgres).

- **Vercel (serverless):** static pages served from the repo root, and the API runs
  as serverless functions in `/api` (talking to Supabase + Resend). Recommended if
  you're already on Vercel.
- **Render / Railway (persistent server):** run `server.js`, which serves the static
  site AND the API from one Node process. Uses the same `/lib` logic minus serverless.

`server.js` and the `/api` functions share the same logic; you don't need both hosts.

---

## Option A — Vercel (serverless + Supabase)

The frontend already calls `/api/*`, which Vercel maps to the functions in `/api`:
`register`, `stats`, `registrations` (list), `registrations/bulk-status`,
`registrations/[id]/status`.

1. Import the repo into Vercel (Framework Preset: **Other** — `vercel.json` sets this).
2. Add **Environment Variables** (Project Settings → Environment Variables):
   - `DATABASE_URL` — Supabase **pooler** string. For serverless use the
     **Transaction pooler** (Supabase → Database → Connection pooling → Transaction,
     port `6543`). The direct `db.<ref>.supabase.co` host is not built for serverless.
     URL-encode special chars in the password (`@` -> `%40`).
   - `RESEND_API_KEY`
   - `ADMIN_TOKEN` (dashboard login — pick something strong)
   - optional: `MAIL_FROM`, `MAIL_REPLY_TO`
3. Redeploy. The `registrations` table is auto-created on first request.
4. Live: `/` landing · `/register.html` · `/dashboard.html`.

> Why the pooler: each serverless invocation opens its own DB connection. Supabase's
> transaction pooler (Supavisor) is designed for that; the direct connection will
> exhaust connection limits under load.

---

## Option B — Render (persistent Node server)

1. Push this repo to GitHub (already on `github.com/mrsarthak001/circuitX`).
2. Get the **IPv4-safe** Postgres URL from Supabase:
   Project → **Settings → Database → Connection pooling → Session mode** → copy the
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   string. URL-encode special chars in the password (`@` → `%40`).
   > Don't use the direct `db.<ref>.supabase.co:5432` host — it's often IPv6-only and
   > Render (IPv4) can't reach it.
3. In Render: **New + → Blueprint**, connect the repo. Render reads `render.yaml`.
4. When prompted, paste the secret env vars:
   - `DATABASE_URL` = the Session-pooler string from step 2
   - `RESEND_API_KEY` = your Resend key
   - `ADMIN_TOKEN` = a strong secret for the dashboard
   (`MAIL_FROM` / `MAIL_REPLY_TO` come from `render.yaml`; edit if you have a domain.)
5. Click **Apply**. First deploy runs `npm install` then `node server.js`.
   The table is auto-created on boot.
6. Your app is live at `https://circuitx.onrender.com` (or your chosen name):
   - Landing: `/`  ·  Register: `/register.html`  ·  Admin: `/dashboard.html`

## Option B — Railway
New Project → Deploy from GitHub → add the same env vars in **Variables** →
Railway auto-detects `npm start`. (No blueprint needed.)

---

## After deploy
- **Custom domain:** add it in the host's dashboard; DNS a CNAME to the service.
- **Real emails:** verify a domain in Resend (SPF/DKIM), then set
  `MAIL_FROM=CircuitX <noreply@yourdomain.com>`. The sandbox
  `onboarding@resend.dev` only reaches your own Resend account email.
- **Rotate secrets** that were shared during setup (Supabase DB password, Resend key).

## Env vars (all)
See `.env.example`. Required: `DATABASE_URL`, `RESEND_API_KEY`, `ADMIN_TOKEN`.
Optional: `MAIL_FROM`, `MAIL_REPLY_TO`, `PORT` (host sets this automatically),
`WAITLIST_BASE` (default 0).
