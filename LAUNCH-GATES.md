# NINK launch gates

Do **not** launch mainnet until every gate passes. Local Hardhat quirks (MetaMask not listing tokens) are **not** launch blockers if the gates below pass.

## Gate 1 — Contract truth (automated)

- [ ] `npx hardhat test` — all green
- [ ] Token: exactly 100M NINK minted once, no mint functions
- [ ] Registry: `anchorFee` starts at 0.01 NINK, `setAnchorFee` owner-only
- [ ] `anchorState` pulls fee via `transferFrom` and emits `AnchorRecorded`

## Gate 2 — In-app balance (users never rely on MetaMask alone)

- [ ] Extension popup shows **On-chain NINK** from `balanceOf` (token contract RPC)
- [ ] Anchor fee shown from registry `anchorFee()`
- [ ] Sign-off disabled when on-chain balance &lt; fee
- [ ] Label states balance is from **contract**, not MetaMask UI

## Gate 3 — Wallet UX (pre-launch testnet)

- [ ] Verify token on **Base Sepolia** with block explorer + token list submission
- [ ] Document: “Balance of record is in NINK extension”

## Gate 4 — Public network deploy

- [ ] Deploy `ProjectNinkToken` + `NinkRegistry` to target L2 (e.g. Base)
- [ ] Verify both contracts on block explorer
- [ ] Update `chainConfig.js` with production RPC + addresses
- [ ] Submit token to explorer token list + CoinGecko / Uniswap list (post-audit)

## Gate 5 — End-to-end sign-off

- [ ] User approves NINK spend to registry
- [ ] Sign-off anchors hash, fee moves to treasury
- [ ] `.nink` envelope contains `transactionHash` + `stateHash`
- [ ] Viewer decrypts and shows audit record

## Gate 6 — Ops

- [ ] Treasury multisig (not single deployer key)
- [ ] `setAnchorFee` runbook if NINK price moves
- [ ] Monitoring: registry events, failed anchors, RPC health

---

## What local MetaMask problems mean

| Symptom | Launch risk? |
|--------|----------------|
| NINK not visible on Hardhat local | **No** — localhost is dev-only |
| Hardhat console shows correct balance | Token contract OK |
| Extension **On-chain NINK** panel correct | **Primary user UX — required for launch** |
| Token visible on Base Sepolia explorer + lists | Wallet discovery OK |

**Rule:** Ship when **extension + explorer + testnet** prove balances. Never ship when the only place users check balance is MetaMask on localhost.
