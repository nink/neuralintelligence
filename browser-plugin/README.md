# NINK Work-Product Authenticator (browser plugin)

Chrome Manifest V3 extension — encrypt AI chat sessions locally and anchor a state hash on-chain.

**Current version:** see `manifest.json` (e.g. 1.8.1)  
**Capture schema:** v7 (`captureSchemaVersion` in payload)

## Load in Chrome

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Select this folder (`browser-plugin/`)
3. Reload after code changes (Remove + Load unpacked if build mismatches)

## Sign-off

1. Open a supported AI chat tab
2. Click the NINK extension icon → **Press NINK to Sign-Off**
3. Save `.nink` + `.ninkkey` when prompted

Supported platforms include ChatGPT, Gemini, Claude, Grok, Perplexity, Copilot, Poe, Meta AI, DeepSeek, Mistral, and others (see `src/config/chatPlatforms.global.js`).

## Viewer

Serve over HTTP (required for file APIs):

```powershell
# From repo root, if you add a serve script; or use any static server on this folder
Start-Process "http://127.0.0.1:8765/viewer.html"
```

Drop `.nink` and matching `.ninkkey` on the dropzone to decrypt.

## Dev stubs

```powershell
node scripts/dev-stub-server.mjs
```

Enables local accounting/anchor without `api.nink.network`.

## Key files

| File | Role |
|------|------|
| `src/content/scrapers.js` | Chat scrape, attachments, `auditRecord` |
| `src/popup/popup.js` | Sign-off, encrypt, download |
| `src/utils/cryptoEngine.js` | AES-GCM + SHA-256 |
| `viewer.html` | Decrypt + audit timeline UI |

## Audit payload

Encrypted sessions include `auditRecord`:

- `interactionSummary`, `interactionTimeline`
- `unexposedMediaManifest` / `exposedMediaManifest`
- `environmentTelemetry`, `sessionContext`, `signOffContext`

See [../ARCHITECTURE.md](../ARCHITECTURE.md).
