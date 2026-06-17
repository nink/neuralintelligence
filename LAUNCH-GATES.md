# NINK launch gates (dual-rail)

Do **not** launch public Rail 1 or Rail 2 until the relevant gates pass. See [`PIVOT-DUAL-RAIL.md`](PIVOT-DUAL-RAIL.md) for architecture and [`pre-dual-rail-2026-06`](https://github.com/nink/neuralintelligence/tree/pre-dual-rail-2026-06) for the archived single-rail prototype.

**Priority:** Complete **Rail 1** (virtual NINK, closed-loop) first. **Rail 2** new work is deferred; existing wallet/contract code is preserved on the archive branch.

---

## Shared — Product & proof (both rails)

### Gate S1 — Session capture & encryption

- [x] Multi-platform chat scrape (ChatGPT, Gemini, Claude, etc.)
- [x] Sign-off produces `.nink` + `.ninkkey` pair
- [x] Capture inject without manual tab refresh (stable scraper)
- [x] Sign-off runner + popup status sync

### Gate S2 — Session Viewer

- [x] Viewer decrypts conversation and shows metadata (`stateHash`, anchor proof fields)
- [x] Audit record / timeline renders for captured sessions
- [ ] Viewer displays Rail 1 `proofId` vs Rail 2 `transactionHash` distinctly (label polish)

### Gate S3 — Encryption & key custody (future — enterprise)

See [`REQUIREMENTS-ENCRYPTION-KEY-CUSTODY.md`](REQUIREMENTS-ENCRYPTION-KEY-CUSTODY.md). **Not required for Rail 1 v1 consumer launch.**

- [ ] **S3-A Escrow:** Wrap session AES key with NINK public key; store `escrow_key_blob` + version on every anchored sign-off
- [ ] **S3-B Custody record:** Append-only `key_custody_records` linked to `proof_id` — answer “where is the key?” without user testimony
- [ ] **S3-C Key separation:** Session keys (`NINK-SESSION-*`) vs API keys (`NINK-API-{org}-*`) — separate tables, rotation, and docs
- [ ] **S3-D Break-glass:** HSM unwrap service, dual control, immutable access log (legal / enterprise DPA)
- [ ] **S3-E Plain export (optional):** Advanced toggle for unencrypted export; org policy can disable
- [ ] **S3-F Enterprise policy:** `require_encryption`, `require_escrow`, `forbid_plain_export` enforced at sign-off API
- [ ] **S3-G UX:** Post-sign-off custody summary in popup (proof ID, escrow tier, “not an API key”)

---

## Rail 1 — Virtual NINK (default users) — **ship first**

Closed-loop: card-funded **virtual NINK** in PostgreSQL. Same UI language (“NINK”, “0.01 NINK per sign-off”). **No on-chain mint** at purchase; **no wallet** in default UI.

### Gate R1-A — Auth & account

- [ ] Production auth (replace email-only stub)
- [ ] Extension default path: sign in → **Your NINK** from virtual ledger API
- [ ] Sign-out clears session reliably
- [ ] Terms: virtual NINK usable only inside Project NINK until KYC conversion

### Gate R1-B — Virtual balance & purchases

- [ ] PostgreSQL schema: users, virtual balances, append-only ledger, purchases
- [ ] Payment processor webhook ($20 NINK pack or equivalent)
- [ ] `GET /v1/accounting/parameters` returns virtual NINK balance + fee (0.01 NINK)
- [ ] Sign-off disabled when virtual balance &lt; fee

### Gate R1-C — Debit on sign-off

- [ ] `POST /v1/nink/debit-anchor` (or equivalent) atomically debits virtual NINK + records `proofId`
- [ ] No blockchain call required for Rail 1 sign-off
- [ ] `signOffContext` records rail=`virtual`, fee, `proofId`; Viewer shows proof

### Gate R1-D — Compliance isolation

- [ ] Default UI has no wallet, withdraw, transfer, P2P, or contract addresses
- [ ] Advanced / wallet mode hidden or clearly labeled “issued NINK — requires KYC’d acquisition”
- [ ] Closed-loop legal review signed off before public launch

### Gate R1-E — End-to-end (Rail 1)

- [ ] Buy virtual NINK → sign-off → Viewer verifies session
- [ ] Balance decrements correctly per sign-off
- [ ] Production API hosted (not localhost JSON store)

---

## Rail 2 — Issued NINK (Advanced + agents) — **after Rail 1**

Open-loop: on-chain NINK on Base L2. KYC before mint/purchase from NINK or partner, or before virtual→issued conversion.

### Gate R2-A — Contracts (preserved — minimal new work)

- [ ] `npx hardhat test` — all green
- [ ] Token: 100M NINK minted once; registry `anchorFee` 0.01 NINK
- [ ] Deploy to Base Sepolia → mainnet; verify on explorer
- [ ] *(Already prototyped on archive branch: wallet mode + local relayer)*

### Gate R2-B — KYC & issuance

- [ ] KYC provider integrated (human users)
- [ ] Virtual → issued conversion: KYC → mint up to verified virtual balance → ledger debit
- [ ] Direct token purchase from NINK/partner only after KYC

### Gate R2-C — Advanced extension mode

- [ ] MetaMask connect → on-chain balance → `anchorState` sign-off *(code exists on archive)*
- [ ] Re-enable Advanced toggle for production with KYC-aware copy
- [ ] Label: balance from **contract**, not MetaMask UI

### Gate R2-D — Velocity & agent API

- [ ] Wallet daily cap ≤ $100 USD-equiv NINK / 24h per address
- [ ] IP aggregate cap ≤ $100 / 24h; cooldown on breach
- [ ] API returns `VELOCITY_LIMIT_EXCEEDED` when limits hit
- [ ] AI agent API keys + separate compliance onboarding

### Gate R2-E — Ops

- [ ] Treasury multisig (not single deployer key)
- [ ] `setAnchorFee` runbook; monitoring (registry events, failed anchors, RPC)
- [ ] MSB / LVCTR / STR runbooks (compliance ops)

---

## Archive — single-rail prototype (completed pre-pivot)

The following were achieved on **`pre-dual-rail-2026-06`** / **`archive/single-rail-account-mode`** and should not be re-built from scratch:

| Item | Status on archive |
|------|-------------------|
| Gate 3 viewer + sign-off loop | Done |
| Gate 4 API skeleton (`packages/api`, local JSON store) | Done |
| Account mode + popup login via API | Done |
| Wallet Advanced mode + Mock mode | Done |
| Hardhat contracts + relayer smoke test | Done |

---

## Build order

1. ~~Shared product (Gates S1–S2 core)~~ — done on archive branch
2. **Rail 1** — Gates R1-A through R1-E
3. **Rail 2** — Gates R2-A through R2-E (reuse archived wallet/contract work)
4. **Enterprise encryption** — Gates S3-A through S3-G (after Rail 1 stable)

---

## Local dev notes

| Symptom | Launch risk? |
|--------|----------------|
| MetaMask NINK not visible on Hardhat | **No** — dev-only |
| `packages/api` on port 8787 | Prototype for Rail 1 API shape; replace JSON with Postgres |
| Legacy `dev-stub-server.mjs` on 8786 | Deprecated — do not use for Gate 4/Rail 1 |

**Rule:** Ship Rail 1 when **virtual NINK purchase + debit sign-off + Viewer** pass Gates R1-* with counsel-approved closed-loop terms. Rail 2 is optional for power users and agents until KYC and velocity gates pass.
