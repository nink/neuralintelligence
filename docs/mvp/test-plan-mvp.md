# MVP test plan — repeatable demo

Use this script to validate the full evidence-package + access-control + billing loop. Test accounts used in production validation:

- **Alice:** `peter@nink.com`
- **Bob:** `nink101@gmail.com`

## Prerequisites

- [ ] Supabase migrations **001–007** applied (especially **005**, **006**, **007**)
- [ ] API live at `https://ni.nink.com` with `NINK_STORE=supabase`, `RESEND_API_KEY`, `NINK_PACKAGE_MASTER_KEY`
- [ ] **New laptop:** create account at [https://ni.nink.com/signup](https://ni.nink.com/signup) → [install extension](https://ni.nink.com/extension/install) (one command; files hosted at `/extension/`, no zip)
- [ ] Extension loaded at **v1.14.2+** (`chrome://extensions` → Reload after updates)
- [ ] Two Chrome profiles or sequential sign-in/sign-out (Alice then Bob)
- [ ] ChatGPT tab open for Alice sign-off

## Demo script

### 1. Alice signs in and creates / signs off a ChatGPT session

1. Extension popup → sign in as **Alice**
2. Open a ChatGPT conversation (e.g. cat pictures test thread)
3. Click **Sign Off — Credits**
4. Save **`.nink`** and **`.ninkkey`** when prompted
5. **Expect:** Sign-off completes; **no viewer tab** auto-opens
6. **Expect:** Alice balance decreases by **10 credits** (sign-off fee)

### 2. Cloud package is created

1. Open Alice’s `.nink` in a text editor (optional)
2. **Expect:** JSON contains `"packageId": "<uuid>"`
3. Or: Extension → Load session & view → metadata **Cloud package ID** shows UUID (not “None”)

**Supabase check (optional):**

```sql
select id, owner_id, title, created_at
from evidence_packages
order by created_at desc
limit 1;
```

### 3. Bob loads Alice’s package

1. Sign out Alice; sign in as **Bob** in extension popup
2. Popup → **Load session & view** → select Alice’s **`.nink`** only (cloud-backed)
3. **Expect:** Extension viewer tab (`chrome-extension://…/viewer.html`)
4. **Expect:** Banner: **Cloud-backed package: paid unlock required**
5. **Expect:** Local `.ninkkey` does not decrypt conversation (strict cloud mode)

### 4. Bob is denied access

1. Scroll to **Cloud unlock (required)**
2. **Expect:** **Open package** / **Verify** / **Report** disabled
3. **Expect:** Message that owner approval is required
4. **Optional API check:** `GET /v1/packages/access-status` → `accessStatus: "none"`

**Audit (optional):** after status check, `package_access_events` may contain `access_blocked`.

### 5. Bob requests access

1. Click **Ask owner for access** (optional message)
2. **Expect:** Status: request sent; owner emailed

### 6. Alice receives request

1. Check **Alice’s email** (`peter@nink.com`)
2. **Expect:** Subject like “NINK access request from nink101@gmail.com”
3. **Expect:** **Approve access** and **Deny access** buttons

### 7. Alice approves

1. Click **Approve access** in email
2. **Expect:** Browser page: “Access approved”
3. **Expect:** Bob receives approval email (optional but implemented)

**Supabase check (optional):**

```sql
select status from package_access_requests
where package_id = '<package-uuid>' and requester_id = '<bob-uuid>';

select * from package_access_grants
where package_id = '<package-uuid>';
```

### 8. Bob reloads viewer

1. Bob’s viewer tab → **reload** (F5)
2. **Expect:** Cloud panel shows owner approved; unlock buttons **enabled**
3. **Expect:** Bob balance shown (e.g. 500 credits if unused)

### 9. Bob opens package

1. Click **Open package · 10 credits**
2. **Expect:** Conversation renders (e.g. cat pictures thread)
3. **Expect:** Cloud panel may hide after successful open

### 10. Bob is charged 10 credits

1. Extension popup → **Your credits**
2. **Expect:** Balance reduced by **10** (e.g. 500 → 490)

### 11. Ledger entry is created

```sql
select entry_type, amount_wei, balance_after, metadata, created_at
from nink_ledger
where user_id = '<bob-uuid>'
order by created_at desc
limit 5;

select action, amount, package_id, created_at
from credit_transactions
where user_id = '<bob-uuid>'
order by created_at desc
limit 5;
```

**Expect:** `package_view` debit; `amount` = 10 credits.

### 12. Bob with insufficient credits

**Option A — spend down balance:** Repeat verify/report/open until balance &lt; 10.

**Option B — SQL (test env only):** set Bob’s `balance_wei` below 10 credits.

1. Bob reloads viewer, gets approval (or use granted user)
2. Click **Open package**
3. **Expect:** HTTP **402** / error “Insufficient credits” in viewer
4. **Expect:** No conversation displayed; no permanent charge (debit not committed on insufficient balance)

## Negative cases (quick)

| Case | Steps | Expect |
|------|-------|--------|
| Alice denies | Bob requests → Alice clicks **Deny** | Bob email denied; Ask owner again; no unlock |
| No response | Bob requests; Alice ignores email | Stays pending; no unlock |
| Wrong viewer | Bob opens `.nink` from Downloads (`file://`) | No cloud panel, no Ask owner |
| Local-only file | Old `.nink` without `packageId` | Free local decrypt with `.ninkkey`; no Ask owner |
| Not signed in | Bob loads package, clicks Ask owner | Prompt to sign in via popup |

## Pass criteria

All of **steps 1–11** complete once without manual DB fixes. Step **12** confirms billing guardrails.

## Known limitations (do not file as bugs for MVP)

- Viewer does not auto-refresh access status; reload required after approval
- No grant revocation UI
- No web upload UI on `ni.nink.com` — files via extension only
- Report download is JSON, not PDF
