# Deploying CircuitX

The Node server (`server.js`) serves **both** the static site (landing, register,
dashboard) **and** the API, and connects to Postgres. So it's a single deploy.

Frontend + backend + DB all run from this one service. GitHub Pages can host the
static pages but **cannot** run the API, so deploy the Node service instead.

---

## Option A — Render (recommended, has a free tier)

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
