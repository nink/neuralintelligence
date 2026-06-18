# Evidence package MVP

## What a NINK evidence package is

A **NINK evidence package** is a signed-off, encrypted snapshot of a human–AI chat session. It includes:

- Encrypted conversation payload (messages, attachments metadata, audit record)
- Anchor metadata (`stateHash`, proof / transaction fields)
- Optional **cloud registration** (`packageId`) linking the session to a row in `evidence_packages`

The MVP supports two related artifacts:

1. **Local files** (`.nink` + `.ninkkey`) — always produced at sign-off
2. **Cloud package** — created when the user is signed in to Rail 1 (virtual NINK) at sign-off time

## `.nink` files

- JSON archive downloaded at sign-off
- Contains **outer** session metadata and `encryptedPayload` (base64 ciphertext)
- When cloud registration succeeds, includes **`packageId`** (UUID)
- Does **not** contain the session AES key in strict production mode
- Safe to share with third parties only in the sense that ciphertext is opaque; **with `.ninkkey`, local decrypt is still possible for files without `packageId`**

Typical fields: `version`, `blockchainNetwork`, `stateHash`, `encryptedPayload`, `payloadCompression`, `packageId` (if cloud-backed).

## `.ninkkey` files

- Holds the **client-side AES-256-GCM key** (base64) used to encrypt the payload in `.nink`
- Downloaded as a separate file at sign-off (pairing by filename: `session.nink` / `session.ninkkey`)
- In **strict cloud mode**, possession of `.ninkkey` does **not** unlock cloud-backed packages in the viewer — cloud unlock goes through the API

## `packageId`

- UUID primary key of `public.evidence_packages`
- Written into `.nink` JSON when `POST /v1/packages/create` succeeds during sign-off
- Signals **cloud-backed** package: viewer shows cloud panel, strict cloud rules apply
- If missing (`None (local-only file)` in viewer metadata), the session predates cloud upload or upload failed — **Ask owner** workflow is unavailable

## Cloud-backed packages

On sign-off (Rail 1, signed in, not dev-stub / not wallet mode):

1. Extension builds plaintext session payload (conversation + audit record)
2. API `POST /v1/packages/create` encrypts payload server-side and stores row in `evidence_packages`
3. `packageId` returned and embedded in downloaded `.nink`

Server storage (`evidence_packages`):

| Column | Purpose |
|--------|---------|
| `owner_id` | `app_users.id` of signer |
| `encrypted_payload` | AES-256-GCM envelope JSON (`iv`, `ciphertext`, `authTag`) |
| `payload_hash` | SHA-256 of plaintext JSON (integrity check on decrypt) |
| `encryption_version` | `aes-256-gcm-v1` |
| `state_hash` | Anchor hash from sign-off |

Master key: `NINK_PACKAGE_MASTER_KEY` (API env only).

## Strict cloud mode

**Default:** `strictCloudMode: true` in extension config (`src/config/ninkConfig.js`).

| Condition | Viewer behaviour |
|-----------|------------------|
| `.nink` has **no** `packageId` | **Local-only** — free decrypt with matching `.ninkkey` |
| `.nink` has `packageId` + strict mode **on** | Local `.ninkkey` decrypt **disabled**; must use paid **Cloud unlock** API |
| `packageId` + strict mode **off** (Advanced toggle) | Dev/test — local `.ninkkey` decrypt allowed again |

Handoff from popup/sign-off uses **`chrome.storage.session` only** — key material is not written to `chrome.storage.local` for cloud-backed packages.

## Encryption approach (MVP)

### Layer 1 — Client (sign-off)

- AES-256-GCM in browser (`crypto.subtle`)
- Random 32-byte key → `.ninkkey`
- Ciphertext in `.nink` `encryptedPayload`
- Optional gzip compression (`payloadCompression: "gzip"`)

### Layer 2 — Server (cloud package)

- Separate encryption with `NINK_PACKAGE_MASTER_KEY`
- Plaintext session JSON encrypted at upload; stored in `encrypted_payload`
- On view/verify/report: decrypt server-side, verify `payload_hash`, return JSON to authorized caller

**Important:** Cloud view returns decrypted conversation to the extension over HTTPS; it is rendered in page memory only (not persisted to `localStorage`).

## Viewer behaviour (extension v1.14.2)

Entry points:

- Extension popup → **Load session & view** (recommended on Windows)
- Extension viewer tab → drop zone / file picker

**Not supported for MVP workflows:** opening `.nink` via `file://` in a normal Chrome tab (no extension scripts, no cloud panel).

### After loading `.nink`

1. **Metadata panel** — version, network, state hash, **Cloud package ID**
2. **Package mode banner**
   - `Cloud-backed package: paid unlock required`
   - `Local-only package: free local decrypt`
3. **Decrypt panel** — local key status (blocked for cloud + strict mode)
4. **Cloud unlock panel** (only if `packageId` present)
   - **Ask owner for access** (non-owner, not yet granted)
   - **Open package · 10 credits** / **Verify** / **Report** (owner or granted user)

### Sign-off workflow (Alice)

- Sign-off downloads `.nink` + `.ninkkey`
- Sign-off runner **does not** auto-open viewer (MVP as of v1.14.1+)
- Alice opens viewer manually if she wants to inspect the session

## API routes (packages)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/packages/create` | Register cloud package (sign-off) |
| `GET` | `/v1/packages/access-status` | Owner / granted / pending / denied |
| `POST` | `/v1/packages/request-access` | Bob asks owner |
| `POST` | `/v1/packages/view` | Decrypt + return payload (10 credits) |
| `POST` | `/v1/packages/verify` | Integrity check (5 credits) |
| `POST` | `/v1/packages/download-report` | JSON report (5 credits) |
| `GET` | `/access-request/respond?token=…` | Owner approve/deny from email |
