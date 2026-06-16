# Dual-rail pivot — Project NINK billing & access

**Status:** Planning approved (June 2026)  
**Reason:** Canadian FINTRAC — direct token purchase or issuance to users requires KYC. Casual users need a **closed-loop** path; tech users, AI agents, and on-chain flows remain on a separate **open-loop** rail.

**Backup of pre-pivot work:** Git tag `pre-dual-rail-2026-06` and branch `archive/single-rail-account-mode` (see [Recovery](#recovery)).

---

## One product, two settlement layers

Users always interact with **NINK** as the brand. What differs is whether balance is **virtual** (ledger) or **issued** (on-chain).

| Term | Meaning | On-chain? | KYC to acquire? |
|------|---------|-----------|-----------------|
| **Virtual NINK** | Fiat-funded balance in PostgreSQL; spent in-app only | No | No (closed-loop voucher — counsel to confirm) |
| **Issued NINK** | ERC-20 on Base L2; self-custody or relayer | Yes | Yes — before mint, purchase from NINK/partner, or withdrawal from virtual balance |

**User-facing copy (Rail 1):** “Buy $20 NINK”, “Your NINK: 100.0000”, “0.01 NINK per sign-off” — same language as today. Terms must state virtual NINK is **usable only inside Project NINK** until KYC conversion.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  SHARED — both rails (already built, keep)                      │
│  Extension scrape → encrypt → stateHash → .nink + .ninkkey      │
│  Session Viewer · audit schema v7 · sign-off runner             │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         ▼                                       ▼
┌─────────────────────┐               ┌─────────────────────┐
│  RAIL 1 — Default   │               │  RAIL 2 — Advanced  │
│  Virtual NINK         │               │  Issued NINK        │
├─────────────────────┤               ├─────────────────────┤
│ Card / Interac      │               │ KYC (human)         │
│ PostgreSQL ledger   │               │ Agent API + KYC     │
│ Debit 0.01 / anchor │               │ MetaMask / relayer  │
│ No wallet UI        │               │ Velocity limits       │
│ No P2P / withdraw   │               │ Base Sepolia/mainnet│
└─────────────────────┘               └─────────────────────┘
         │                                       │
         └─────────── KYC conversion ────────────┘
              virtual balance → mint issued NINK
```

---

## Rail 1 — Web2 closed-loop (build next)

**Audience:** Casual / default extension users (“boomer rail” in internal diagrams).

### Flow

1. Sign up (email auth; production-grade auth before public launch).
2. Buy **$20 NINK** (or other packs) via payment processor — records **virtual NINK** credit, not chain mint.
3. Extension shows **Your NINK** and **0.01 NINK** per sign-off (unchanged UX labels).
4. Sign-off → API atomically debits virtual balance → returns ledger proof ID in `signOffContext` (no user wallet, no on-chain tx required for Rail 1).
5. User downloads `.nink` + `.ninkkey`; Viewer unchanged.

### PostgreSQL (planned schema)

| Table | Purpose |
|-------|---------|
| `users` | Account id, email, `rail = closed_loop`, timestamps |
| `virtual_nink_balances` | `user_id`, balance in smallest unit (18-decimal compatible with UI math) |
| `nink_purchases` | Payment processor id, fiat amount, virtual NINK credited, status |
| `nink_ledger` | Append-only: purchase, debit_anchor, refund, admin_adjust, conversion_out |
| `anchor_events` | `user_id`, `state_hash`, fee, `proof_id`, rail=`virtual`, timestamp |

### Compliance isolation (Rail 1 UI + API)

- No wallet connect, token contract addresses, withdraw, transfer, or P2P in default path.
- No language implying open-loop crypto redemption without KYC.
- Virtual NINK cannot leave the system except via documented **KYC conversion** (Rail 2 bridge, later).

### Maps from current codebase

| Existing | Rail 1 target |
|----------|----------------|
| `packages/api` JSON store | PostgreSQL + payment webhooks |
| `GET /v1/accounting/parameters` | Same shape; balance = virtual NINK |
| `POST /v1/blockchain/anchor` | Replace with `POST /v1/nink/debit-anchor` (ledger debit; optional internal proof id) |
| Extension account mode + popup labels | Keep “NINK” wording; backend = virtual ledger |
| `signOffContext.transactionHash` | Null or internal `proofId` for Rail 1; Viewer already tolerant |

---

## Rail 2 — Web3 open-loop (preserve, defer new work)

**Audience:** Advanced extension users, AI agents, anyone with **issued** NINK.

**Assumption:** If a user holds issued NINK in a self-custody wallet, they (or their venue) already passed KYC when acquiring it. **Advanced mode** (MetaMask + registry `anchorState`) remains valid — no further extension work until Rail 1 is production-ready.

### Preserve without reinvention

| Asset | Location | Notes |
|-------|----------|--------|
| `ProjectNinkToken` + `NinkRegistry` | `packages/contracts/` | Gate 1; deploy Base when Rail 2 launches |
| Wallet / Advanced mode | `browser-plugin/` popup toggle | Hidden until Rail 2 ready |
| On-chain relayer | `packages/api/src/relayer.mjs` | Rail 2 anchor path only |
| Hardhat local dev | contracts + chainConfig | Unchanged |

### Future Rail 2 requirements (after Rail 1)

- KYC provider integration (Pliance, Sumsub, etc.) before mint or virtual→issued conversion.
- **Velocity limits** on open-loop API (software-enforced):
  - Wallet daily cap: ≤ **$100 USD-equivalent** NINK per address / 24h rolling window.
  - IP aggregate cap: ≤ **$100** per IP/fingerprint / 24h; exceed → 24h cooldown.
  - Reject with `VELOCITY_LIMIT_EXCEEDED` when cap breached.
- AI agent API: API keys, separate compliance onboarding, Rail 2 only.
- MSB / LVCTR / STR program — legal ops, not extension code.

### Virtual → issued conversion (future bridge)

1. User requests withdrawal / conversion from virtual balance.
2. KYC completes.
3. Mint/transfer **issued NINK** on Base up to verified virtual balance.
4. Debit virtual ledger (prevent double spend).

---

## Shared product layer (do not rebuild)

- Multi-platform chat capture (`browser-plugin/src/content/scrapers.js`)
- Encryption pipeline (`runSignOffPipeline.js`)
- Session Viewer (`viewer.html`)
- Audit record / timeline schema
- Sign-off runner + popup status sync
- Auto-inject scraper (`chatTab.js`)

---

## Build order (post-pivot)

1. **Tag & archive** current `main` → `pre-dual-rail-2026-06` (done when this doc lands).
2. **Legal** — closed-loop memo for virtual NINK; MSB scope for issued NINK.
3. **Rail 1 backend** — PostgreSQL, Stripe (or equivalent), virtual debit anchor API.
4. **Rail 1 extension** — point default account mode at virtual ledger API (keep NINK labels).
5. **Rail 1 launch gates** — see `LAUNCH-GATES.md`.
6. **Rail 2** — KYC, velocity middleware, Base deploy, Advanced mode re-enabled for production, agent API.

---

## Recovery

To restore the **single-rail account mode + Gate 4 API prototype** (email login, JSON store, optional Hardhat relayer):

```powershell
cd github-backup/neuralintelligence
git fetch origin
git checkout archive/single-rail-account-mode
# or: git checkout pre-dual-rail-2026-06
```

That snapshot includes:

- Gate 3 complete (viewer, sign-off loop, capture fix)
- Gate 4 skeleton (`packages/api` on port 8787)
- Extension account mode + Advanced wallet mode + Mock mode
- Popup-direct login, logout fix, API health checks

---

## Open decisions

| # | Question | Default bias |
|---|----------|--------------|
| 1 | Rail 1 anchor proof: ledger `proofId` only vs batch merkle to L2? | Ledger only for v1 |
| 2 | Virtual NINK decimals | Match 18-decimal UI math (0.01 NINK fee) |
| 3 | Pack pricing | $20 CAD virtual NINK pack first |
| 4 | Conversion minimum | TBD with counsel |
| 5 | AI agents | Enterprise invoice + custodial pool vs per-agent wallet |

---

## Related docs

- [`LAUNCH-GATES.md`](LAUNCH-GATES.md) — revised dual-rail checklist
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — session trust boundaries (encryption unchanged)
- [`packages/api/README.md`](packages/api/README.md) — current Gate 4 dev server (prototype for Rail 1 API shape)

**Disclaimer:** This document is engineering planning, not legal advice. FINTRAC / MSB obligations require qualified Canadian compliance counsel before public launch.
