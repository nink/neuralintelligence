# NINK Neural Intelligence — MVP baseline

This folder documents the **current MVP** as implemented in the `neuralintelligence` repository (browser extension + `ni.nink.com` API + Supabase). It is the stable baseline for future work — not a roadmap or design proposal.

**Last verified:** June 2026 · extension **v1.14.2** · API commit series through `70a736b`

## What this MVP is

Rail 1 consumer MVP: users sign off AI chat sessions with the Chrome extension, receive encrypted `.nink` / `.ninkkey` files, and (when signed in) register a **cloud-backed evidence package** on `ni.nink.com`. Viewing a cloud-backed package requires **owner approval** (for non-owners) and **virtual NINK credits**. Encryption keys for cloud packages never leave the server.

## In scope (implemented)

| Capability | Doc |
|------------|-----|
| Evidence package creation (sign-off + cloud upload) | [evidence-package-mvp.md](./evidence-package-mvp.md) |
| Dual-layer encryption (.nink client + cloud server) | [evidence-package-mvp.md](./evidence-package-mvp.md) |
| Cloud-backed package viewing (paid API unlock) | [evidence-package-mvp.md](./evidence-package-mvp.md) |
| User ownership (`owner_id` on `evidence_packages`) | [access-control-mvp.md](./access-control-mvp.md) |
| Access requests (Bob → Alice email) | [access-control-mvp.md](./access-control-mvp.md) |
| Approval / denial workflow (email links) | [access-control-mvp.md](./access-control-mvp.md) |
| Credit billing (view / verify / report) | [credit-billing-mvp.md](./credit-billing-mvp.md) |
| Audit logging (`package_access_events`, ledgers) | [credit-billing-mvp.md](./credit-billing-mvp.md), [access-control-mvp.md](./access-control-mvp.md) |
| Repeatable demo / QA script | [test-plan-mvp.md](./test-plan-mvp.md) |

## Intentionally out of scope (future roadmap)

The following are **not** part of this MVP. Do not assume they exist when reading or extending the code:

- **Organization ownership** (packages owned by teams/orgs, not individual users)
- **Enterprise permissions** (roles, delegated admins, org-wide policy)
- **Recovery keys** (user self-recovery without owner)
- **Key escrow** (NINK-held session keys, break-glass unwrap)
- **Legal hold** (litigation preservation, export holds)
- **Blockchain trust ledger** (on-chain evidence access or trust proofs for packages)
- **Professional attestation marketplace** (third-party notaries, paid attestations)

See also `REQUIREMENTS-ENCRYPTION-KEY-CUSTODY.md` and `LAUNCH-GATES.md` for longer-term gates.

## Repository layout (MVP-relevant)

| Path | Role |
|------|------|
| `browser-plugin/` | Chrome MV3 extension — scrape, sign-off, viewer |
| `packages/api/` | Production API (`https://ni.nink.com`) |
| `supabase/migrations/005_*` | `evidence_packages`, `credit_transactions`, debit RPC |
| `supabase/migrations/006_*` | Access requests + grants |
| `supabase/migrations/007_*` | Access attempt audit events |

## Production dependencies

- **Supabase** — PostgreSQL, migrations 001–007 applied
- **Vercel** — API host `ni.nink.com`
- **Resend** — signup verification + access-request emails
- **Env** — `NINK_PACKAGE_MASTER_KEY`, `RESEND_API_KEY`, `SUPABASE_*`, `NINK_STORE=supabase`

## Quick links

- [Evidence packages](./evidence-package-mvp.md)
- [Access control](./access-control-mvp.md)
- [Credit billing](./credit-billing-mvp.md)
- [Test plan](./test-plan-mvp.md)
