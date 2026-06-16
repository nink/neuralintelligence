# NINK cloud API (Gate 4)

Local development server for NINK account auth, balance accounting, and session anchoring.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Service + relayer status |
| `POST` | `/v1/auth/login` | Email login → session token + starting balance |
| `GET` | `/v1/accounting/parameters` | User balance + anchor fee |
| `POST` | `/v1/blockchain/anchor` | Deduct fee atomically, relay hash on-chain |

Auth for accounting/anchor: `Authorization: Bearer <sessionToken>` (or `?user=` for dev only).

## Quick start

```powershell
# Terminal 1 — Hardhat (optional, for real txHash)
cd packages/contracts
npx hardhat node

# Terminal 2 — deploy contracts (once)
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3 — API
cd packages/api
npm install
npm run dev
```

Reload the browser extension, sign in with email, and run sign-off in **NINK account mode** (not Mock mode).

If port 8787 is already in use (legacy `browser-plugin/scripts/dev-stub-server.mjs`), stop that process first or run `NINK_API_PORT=8788 npm run dev` and set `apiBaseUrl: "http://127.0.0.1:8788"` in extension config.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `NINK_API_PORT` | `8787` | HTTP port |
| `NINK_API_HOST` | `127.0.0.1` | Bind address |
| `NINK_RPC_URL` | `http://127.0.0.1:8545` | Hardhat / L2 RPC |
| `NINK_RELAYER_PRIVATE_KEY` | Hardhat account #0 | Pays on-chain anchor fee |
| `NINK_DEPLOYMENT_JSON` | `../contracts/deployments/31337.json` | Registry + token addresses |
| `NINK_API_STORE` | `./data/dev-store.json` | Dev user balances |

New users receive **100 NINK** off-chain balance. Each sign-off deducts **0.01 NINK** before anchoring.

## Production notes

- Replace email-only login with real auth (`password`, OAuth, magic link).
- Persist store in a database, not JSON.
- Run relayer key in a secure vault; use treasury multisig on-chain (Gate 7).
- Deploy behind `https://api.nink.network` and set extension `useLocalApi: false`.
