# NovaFX Backend (Starter)

Real authentication (bcrypt + JWT), a real PostgreSQL database, and the same
strict numeric validation used in the frontend — re-applied server-side,
because client-side checks alone are never enough.

**What this does NOT include, on purpose:**
- No live market data feed (`symbols.last_price` is seeded once and stays
  static until you connect a real price source).
- No live broker/liquidity execution — orders are recorded in your database
  only, they don't touch a real market.
- No payment gateway integration and no endpoint that lets anyone (including
  an "admin" role) auto-credit a deposit. `POST /api/transactions` only ever
  creates a `pending` row. Wiring in a real gateway (and a properly
  role-gated, audited approval flow) is a deliberate next step you should
  take with a licensed payment partner — not something to bolt on casually.

---

## 1. Run it locally

```bash
cd novafx-backend
npm install
cp .env.example .env
# edit .env — at minimum set DATABASE_URL and JWT_SECRET
```

You need a Postgres database. Easiest for local dev: install Postgres, or
use a free hosted one from the deploy steps below even while developing
locally.

Load the schema:
```bash
psql "$DATABASE_URL" -f src/schema.sql
```

Run the server:
```bash
npm run dev
```

Test it:
```bash
curl http://localhost:4000/health
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Aditya","email":"aditya@example.com","password":"testpass123","confirmPassword":"testpass123"}'
```

---

## 2. Deploy — free-tier path

**Database — Supabase or Neon (pick one):**
1. Create a free project at supabase.com or neon.tech.
2. Copy the connection string they give you (Supabase: Project Settings →
   Database → Connection string → "URI").
3. Open their SQL editor (or `psql`) and run the contents of
   `src/schema.sql`.

**Backend — Render or Railway (pick one):**
1. Push this folder to a GitHub repo.
2. On render.com: New → Web Service → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Add environment variables: `DATABASE_URL` (from step above),
     `JWT_SECRET` (generate one — see `.env.example`), `CORS_ORIGIN` (the
     URL your frontend will be served from), `JWT_EXPIRES_IN`.
3. Deploy. Render gives you a live URL like `https://novafx-backend.onrender.com`.

Railway.app works the same way (New Project → Deploy from GitHub → add the
same env vars) if you prefer it over Render.

**Frontend:**
Host the dashboard HTML file on Vercel, Netlify, or GitHub Pages (all have
free tiers, drag-and-drop deploy). In the frontend JS, replace the local
`positions`/`balance` variables with `fetch()` calls to your live backend
URL, e.g.:

```js
const API_BASE = 'https://novafx-backend.onrender.com';

async function login(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  localStorage.setItem('token', data.token); // send this as Bearer token on every other call
}
```

---

## 3. What's left before this is a real product

- **Live prices**: `symbols.last_price` needs a job that updates it from a
  real market data provider on a schedule/stream. Nothing here trades
  against a real market until that exists.
- **Real trade execution**: opening a position here just writes a database
  row. To actually execute in the market you need a broker/liquidity
  provider integration (MT4/5 white-label or a FIX/REST API from a
  regulated broker).
- **Real deposits/withdrawals**: needs a licensed payment gateway, webhook
  verification, and a role-gated admin approval flow with an audit log —
  none of which is in this starter.
- **Compliance**: retail forex/CFD trading is regulated differently by
  country. If you plan to accept real users and real money, get this
  reviewed by a financial/legal advisor before launch — especially for
  Indian users, where RBI/FEMA rules restrict forex trading.
- **Hardening for production**: add refresh tokens or a session table (for
  real "logout all devices"), 2FA, KYC document storage, structured logging,
  automated backups, and monitoring/alerting.
