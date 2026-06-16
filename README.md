# NINK Neural Intelligence

Human–AI interaction proof, audit, and anchoring for the [NINK](https://www.nink.com) platform.

**GitHub org:** [github.com/nink](https://github.com/nink)

This repo is separate from:

| Repo | Purpose |
|------|---------|
| [nink/NINK](https://github.com/nink/NINK) | Public brand site + waitlist ([nink.com](https://www.nink.com)) |
| [nink/dealcheck](https://github.com/nink/dealcheck) | Grocery retail product ([dealcheck.nink.com](https://dealcheck.nink.com)) |
| **nink/neuralintelligence** (this repo) | Neural Intelligence session capture, encryption, and L2 anchoring |

---

## What is Neural Intelligence?

Neural Intelligence is NINK’s approach to **recording and validating human–AI work sessions** — not just storing chat text, but capturing what occurred (messages, attachments, environment, unexposed files) and anchoring a cryptographic proof on-chain.

DealCheck applies Neural Intelligence ideas to grocery shopping. This repo holds the **cross-industry foundation**: the browser plugin and session audit model.

---

## Phase 1: Browser plugin

**Path:** [`browser-plugin/`](browser-plugin/)

Chrome Manifest V3 extension that:

- Scrapes multi-platform AI chats (ChatGPT, Gemini, Claude, Grok, Perplexity, Copilot, etc.)
- Captures images, documents, video references, and audit metadata
- Encrypts the session locally (AES-256-GCM) into a `.nink` + `.ninkkey` pair
- Anchors a SHA-256 state hash to Base Sepolia (dev stubs supported offline)
- Decrypts and renders sessions in `browser-plugin/viewer.html`

### Quick start

1. Chrome → `chrome://extensions` → **Load unpacked**
2. Select the `browser-plugin/` folder
3. Open a supported AI chat tab → extension popup → **Press NINK to Sign-Off**
4. Decrypt in the viewer: serve `browser-plugin/` over HTTP (not `file://`) and drop `.nink` + `.ninkkey`

```powershell
cd packages/api && npm install && npm run dev     # Gate 4 / Rail 1 API prototype (see PIVOT-DUAL-RAIL.md)
```

### Session audit payload (encrypted)

Each sign-off includes an **`auditRecord`** with:

- `interactionSummary` — plain-language session description
- `sessionContext` — URL, model, title, turn counts, scroll audit
- `environmentTelemetry` — user agent, screen, timezone offset, viewport
- `unexposedMediaManifest` — PDFs/audio/video referenced but not in DOM at sign-off
- `exposedMediaManifest` — successfully captured files
- `interactionTimeline` — ordered message + attachment events
- `signOffContext` — fee, balance, identity proof address (when wired)

See [`browser-plugin/README.md`](browser-plugin/README.md) for version and schema details.

---

## Repo layout

```
neuralintelligence/
├── README.md                 # This file
├── ARCHITECTURE.md           # Session model + trust boundaries
├── LAUNCH-GATES.md           # Pre-launch checklist (dual-rail)
├── PIVOT-DUAL-RAIL.md        # Billing pivot plan + recovery tag
├── packages/
│   ├── api/                  # Gate 4 — auth, accounting, anchor relayer
│   └── contracts/            # NINK token + registry (Hardhat)
└── browser-plugin/           # Manifest V3 extension (Phase 1)
    ├── manifest.json
    ├── viewer.html
    ├── src/
    └── scripts/
```

---

## Deployment / hosting

| Surface | Status |
|---------|--------|
| Browser extension | Local load unpacked; Chrome Web Store TBD |
| Viewer | Local HTTP (`viewer.html`); hosted viewer TBD |
| Anchor API | Local `packages/api` (Gate 4); production `api.nink.network` TBD |
| Production chain | Base Sepolia (mock in dev) |

---

## Suggested GitHub repo description

> NINK Neural Intelligence — human–AI session capture, audit, encryption, and L2 anchoring (browser plugin Phase 1).

**Topics:** `nink`, `neural-intelligence`, `browser-extension`, `webcrypto`, `audit`

---

## Status

Active development — browser plugin **v1.8.1**, capture schema **v7** (June 2026).
