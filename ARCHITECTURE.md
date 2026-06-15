# Neural Intelligence — architecture

## Trust boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  User browser (ChatGPT, Gemini, Claude, …)                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  NINK content script — DOM scrape + audit metadata    │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │ plaintext session JSON       │
│  ┌───────────────────────────▼───────────────────────────┐  │
│  │  Popup — WebCrypto encrypt (AES-256-GCM)              │  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ encryptedPayload only
                               ▼
                    ┌──────────────────────┐
                    │  Anchor API / L2     │  stateHash + fee
                    └──────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  .nink + .ninkkey    │  user-owned files
                    └──────────────────────┘
```

**Rule:** Raw conversation text and attachment bytes never leave the browser unencrypted.

## Package layers

### Outer `.nink` (JSON envelope)

Public anchor metadata + encrypted blob:

- `version` — e.g. `NINK-V1.8.1`
- `blockchainNetwork`, `timestamp`, `transactionHash`, `stateHash`
- `encryptedPayload` — base64 ciphertext

### Inner payload (after decrypt)

| Block | Role |
|-------|------|
| `conversation` | Ordered messages with per-turn `meta` |
| `sessionImages` / `sessionVideos` / `sessionDocuments` | Media with `captureStatus` |
| `auditRecord` | Auditor-facing timeline + manifests |
| `sessionContext` | Page/platform/environment snapshot |
| `signOffContext` | Token fee, identity proof, anchor time |

## Attachment capture states

| Status | Meaning |
|--------|---------|
| `success` | File bytes captured (base64 in payload) |
| `metadata-only` | Referenced in chat; not exposed in DOM at sign-off |
| `failed` | Target found; capture error |

Metadata-only attachments appear in the viewer as **yellow warning boxes** and in `auditRecord.unexposedMediaManifest`.

## Platform scrape strategy

1. Detect platform from host + path ([`chatPlatforms.global.js`](browser-plugin/src/config/chatPlatforms.global.js))
2. Scroll checkpoints to load virtualized threads (ChatGPT)
3. Sort messages by `conversation-turn-N` id
4. Discover attachments from chips, aria-labels, and message text
5. Build `interactionTimeline` for audit replay

## Related repos

- [github.com/nink/NINK](https://github.com/nink/NINK) — brand site
- [github.com/nink/dealcheck](https://github.com/nink/dealcheck) — first vertical product
