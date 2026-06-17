# Deploy NINK API to Vercel + Supabase (ni.nink.com)

Rail 1 backend: virtual NINK ledger in Supabase PostgreSQL, API on **https://ni.nink.com**.

---

## What I need from you (secrets — do not paste in chat)

From [Supabase Dashboard](https://supabase.com/dashboard/project/gggceicesawwbvmkioig) → **Settings → API**:

| Variable | Where to use |
|----------|----------------|
| `SUPABASE_URL` | `https://gggceicesawwbvmkioig.supabase.co` (already known) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env + local `packages/api/.env` only |

Optional (not needed for Rail 1 v1):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_ANON_KEY` | Future Supabase Auth in browser — not used yet |

I **cannot** log into your Supabase or Vercel accounts. You add secrets in dashboards; I wire the code.

---

## Step 1 — Run database migration

1. Supabase → **SQL Editor** → New query  
2. Paste contents of [`supabase/migrations/001_rail1_virtual_nink.sql`](../../supabase/migrations/001_rail1_virtual_nink.sql)  
3. **Run** — creates `app_users`, virtual balances, ledger, anchor events, and `debit_virtual_nink_anchor()` RPC

---

## Step 2 — Local test (optional)

```powershell
cd packages/api
copy .env.example .env
# Edit .env — paste SUPABASE_SERVICE_ROLE_KEY
npm install
# Set NINK_STORE=supabase in .env
npm run dev
```

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Expect `"store":"supabase"` in the response.

---

## Step 3 — Vercel project

```powershell
cd packages/api
npx vercel login
npx vercel link
npx vercel env add SUPABASE_URL
npx vercel env add SUPABASE_SERVICE_ROLE_KEY
npx vercel env add NINK_STORE
# value: supabase
npx vercel env add NINK_RAIL_MODE
# value: virtual
npx vercel --prod
```

**Root directory:** set Vercel project root to `packages/api` (monorepo).

### Vercel environment variables (Production)

```
SUPABASE_URL=https://gggceicesawwbvmkioig.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
NINK_STORE=supabase
NINK_RAIL_MODE=virtual
NINK_ANCHOR_FEE_WEI=10000000000000000
NINK_SIGNUP_BONUS_WEI=100000000000000000000
```

---

## Step 4 — Custom domain ni.nink.com

1. Vercel project → **Settings → Domains** → Add `ni.nink.com`  
2. At your DNS host for `nink.com`, add:

| Type | Name | Value |
|------|------|--------|
| CNAME | `ni` | `cname.vercel-dns.com` |

(Vercel may show a project-specific CNAME — use what the dashboard displays.)

3. Wait for SSL (usually a few minutes).

Verify:

```powershell
Invoke-RestMethod https://ni.nink.com/health
```

---

## Step 5 — Point the browser extension at production

In `browser-plugin/src/config/apiConfig.js`, production URL is `https://ni.nink.com`.

For production testing, set in extension storage or `ninkConfig.js`:

```js
useLocalApi: false
```

Reload extension at `chrome://extensions`.

Add `https://ni.nink.com/*` to `manifest.json` host_permissions (already planned in this commit).

---

## Architecture notes

| Env | Store | Anchor behavior |
|-----|-------|-----------------|
| Local dev (default) | JSON file | Optional Hardhat relayer |
| Vercel + Supabase | PostgreSQL | Virtual debit only (`proofId`, no chain tx) |

Payment processor (Stripe) for $20 NINK packs — next slice after API is live on ni.nink.com.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `/health` 500 | Check service role key; confirm migration ran |
| `function debit_virtual_nink_anchor does not exist` | Re-run SQL migration |
| Extension CORS errors | API sends `Access-Control-Allow-Origin: *` |
| Hobby plan function limit | Single catch-all `/api` handler (one serverless function) |
