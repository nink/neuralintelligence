# Future requirements — encryption, escrow & key custody

**Status:** Planned (not implemented)  
**Purpose:** Prevent the “we don’t know where the key is” failure mode when enterprises mandate encryption, fixed storage locations, and named API keys — then something breaks and accountability collapses.

Related: [`PIVOT-DUAL-RAIL.md`](PIVOT-DUAL-RAIL.md), [`LAUNCH-GATES.md`](LAUNCH-GATES.md), [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Problem statement

Enterprise **Company X** may require:

- All signed-off session files **must be encrypted**
- Session decryption material **must be stored in a defined custody tier** (NINK escrow, not “wherever the user saved it”)
- **API keys** (agent/integration) **must use registered names** and live in a separate vault from session keys
- On incident or lawful request, **NINK and the customer can point to exactly one record**: proof ID → key location → key version → who can unwrap

Without this, users or IT can claim: *“The bridge collapsed / we use encryption but we don’t know where the key is.”* That is unacceptable for regulated or enterprise adoption.

**Design goal:** Every anchor creates an **immutable Key Custody Record** — no orphan ciphertext, no unnamed keys, no ambiguous storage.

---

## Three key types (never conflate)

| Key type | Purpose | Custody | Example name prefix |
|----------|---------|---------|---------------------|
| **Session key** (AES) | Decrypt `.nink` conversation payload | User `.ninkkey` **+** NINK escrow copy | `NINK-SESSION-v1` |
| **Escrow wrap key** | NINK Corp master / org subkeys that wrap session AES keys | HSM / KMS only; never in extension | `NINK-ESCROW-MASTER-v1`, `NINK-ESCROW-ORG-{orgId}-v1` |
| **API key** | Authenticate agent/company integrations to NINK API | Secrets vault; **never** in `.nink` files | `NINK-API-{orgId}-{env}` |

**Hard rule:** API keys and session keys use **different namespaces**, different storage tables, and different rotation policies. An API key name must **never** be reused as a session key label.

---

## Sign-off modes (future Advanced + enterprise policy)

### Mode A — Default: User-encrypted + NINK escrow (recommended enterprise default)

1. Browser captures session → **AES-256-GCM** encrypts payload.
2. User receives **`.nink`** (ciphertext + public anchor metadata) + **`.ninkkey`** (user copy of AES key).
3. Browser/API **wraps AES key** with NINK (or org) **public escrow key** → `escrowKeyBlob`.
4. API stores atomically with anchor:

   | Field | Purpose |
   |-------|---------|
   | `proof_id` | Primary handle for support/legal/audit |
   | `state_hash` | Integrity fingerprint of ciphertext |
   | `escrow_key_blob` | Wrapped session key (ciphertext) |
   | `escrow_key_version` | Which public key was used |
   | `escrow_algorithm` | e.g. `X25519-AES256-GCM` |
   | `custody_tier` | `nink_escrow` \| `org_escrow` |
   | `org_id` | Company X tenant id (if enterprise) |

5. **Lawful access:** Authorities / Company X (under contract) request decrypt via **documented break-glass** — NINK unwraps in HSM, action logged. Chain/ledger alone does not decrypt without NINK.

**User-facing terms:** NINK can decrypt under lawful authority or enterprise policy; user still holds their own `.ninkkey` for self-service Viewer access.

### Mode B — Advanced: Plain export (opt-in only)

- Extension Advanced → **“Export readable session (no encryption)”**
- Produces human-readable JSON (or `.nink` with cleartext inner payload)
- **Still anchors** `stateHash` over exported bytes
- Strong UI warning: anyone with the file can read the chat
- **Enterprise policy can disable** this mode org-wide

### Mode C — User-only encryption (today’s behavior; consumer tier)

- AES + `.ninkkey`; **no escrow blob**
- NINK cannot decrypt without user cooperation
- Not suitable for Company X “we must always recover” policies

---

## Key Custody Record (anti-“lost key” bridge)

Every successful sign-off **must** write one append-only custody row (Postgres; optional mirror on-chain in Rail 2):

```
key_custody_records
  proof_id              PK / FK → anchor_events
  state_hash
  user_id
  org_id                nullable
  session_key_location  enum: user_download | nink_escrow_db | on_chain_blob
  escrow_key_blob       nullable (required if policy requires escrow)
  escrow_key_version
  user_key_delivered    boolean  (.ninkkey download confirmed)
  api_key_id            nullable — FK to api_keys, NOT the session key
  policy_id             enterprise policy version enforced at sign-off
  created_at
```

**Support / legal query:** Given `proof_id` or `state_hash` → exactly one row → “session key escrow copy is `escrow_key_blob` at version X in tier Y.” No guessing.

---

## Enterprise policy engine (Company X)

Per-organization config (future `org_policies`):

| Policy flag | Effect |
|-------------|--------|
| `require_encryption` | Block sign-off if encryption skipped |
| `require_escrow` | Block sign-off if `escrowKeyBlob` not stored |
| `forbid_plain_export` | Hide Mode B |
| `mandatory_org_escrow_key` | Wrap with org subkey in addition to NINK master |
| `api_key_namespace` | Enforce `NINK-API-{orgId}-*` naming on integrations |

Sign-off API **rejects** non-compliant exports with explicit error (e.g. `POLICY_VIOLATION: escrow required`).

---

## Master key operations (NINK Corp)

- **Generate** escrow key pair in **HSM / cloud KMS** — private key never in Vercel env, extension, or git.
- **Publish** only **public** wrapping keys to extension/API with monotonic `escrow_key_version`.
- **Rotate** keys; retain old private keys for historical unwrap.
- **Break-glass unwrap service:**
  - Dual control + ticket ID (legal hold / customer DPA / court order)
  - Append-only **access log** (who, when, proof_id, reason code)
  - Output: ephemeral AES key in secure enclave — not emailed in plaintext

Optional: **per-enterprise subkeys** so Company X recovery uses their escrow slice without exposing other tenants.

---

## On-chain vs off-chain storage

| Rail | `state_hash` | `escrow_key_blob` |
|------|--------------|-------------------|
| **Rail 1 (virtual)** | Postgres `anchor_events` | Postgres `key_custody_records` |
| **Rail 2 (issued)** | On-chain registry event + Postgres index | Postgres primary; optional compact hash/commitment on-chain |

Full escrow blobs on-chain are expensive and public (still ciphertext). Prefer **hash/commitment on-chain, blob in DB** unless counsel requires full on-chain escrow.

---

## Extension / Viewer UX (future)

- **Advanced → Encryption:** Default | Escrow (enterprise) | Plain export (if allowed)
- After sign-off, show **Custody summary** in popup:
  - `Proof ID: …`
  - `Session key: downloaded as .ninkkey + copy held by NINK escrow (v3)`
  - `API keys: not applicable to this sign-off` (avoid confusion)
- Viewer: display custody tier and proof ID in metadata panel

---

## What we tell Company X (sales / security one-pager)

1. **Files are encrypted** before they leave the browser (Mode A/B).
2. **Every anchor has a proof ID** tied to a **Key Custody Record** — no anonymous ciphertext.
3. **Session keys and API keys are separate** with enforced naming and storage.
4. **NINK holds escrow** (HSM) for lawful / contractual recovery — not “maybe on someone’s laptop.”
5. **Break-glass is logged** — no silent decryption.

This directly answers: *“Where is the key?”* → **`proof_id` → custody record → escrow blob version X.**

---

## Implementation phases

| Phase | Scope |
|-------|--------|
| **1 (Rail 1)** | Virtual ledger + proof ID + custody record schema (escrow columns nullable) |
| **2** | Escrow wrap at sign-off; HSM public key in extension; break-glass MVP |
| **3** | Enterprise `org_policies`; forbid plain export per org |
| **4** | Optional on-chain escrow commitment (Rail 2) |
| **5** | Org-specific subkeys + customer-facing custody audit export |

---

## Open legal / product questions

1. Default for consumer tier: escrow opt-in or opt-out? (Counsel + privacy policy)
2. Retention period for `escrow_key_blob` and ciphertext backups
3. Canadian lawful access workflow (production order vs voluntary enterprise DPA)
4. Whether Company X gets **direct** unwrap or only via NINK break-glass

---

**Disclaimer:** Engineering requirements only — not legal advice. Privacy, lawful access, and MSB obligations require qualified counsel before enabling escrow in production.
