# NINK launch gates

Do **not** launch mainnet until every gate passes. Local Hardhat quirks (MetaMask not listing tokens) are **not** launch blockers if the gates below pass.

## Gate 1 — Contract truth (automated)

- [ ] `npx hardhat test` — all green
- [ ] Token: exactly 100M NINK minted once, no mint functions
- [ ] Registry: `anchorFee` starts at 0.01 NINK, `setAnchorFee` owner-only
- [ ] `anchorState` pulls fee via `transferFrom` and emits `AnchorRecorded`

## Gate 2 — In-app balance (default: NINK account)

- [ ] Extension popup shows **Your NINK** from signed-in account (API or stub fallback)
- [ ] Sign-off fee shown before sign-off
- [ ] Sign-off disabled when balance &lt; fee
- [ ] Stub login replaced with real auth before public launch

## Gate 2b — In-app balance (advanced: wallet mode)

- [ ] Extension shows **On-chain NINK** from `balanceOf` (token contract RPC)
- [ ] Anchor fee shown from registry `anchorFee()`
- [ ] Sign-off disabled when on-chain balance &lt; fee
- [ ] Label states balance is from **contract**, not MetaMask UI

## Gate 3 — Verify signed sessions

- [ ] Sign-off produces `.nink` + `.ninkkey` pair
- [ ] **Session Viewer** decrypts conversation and shows metadata (`stateHash`, `transactionHash`, network)
- [ ] Audit record / timeline renders for captured sessions

## Gate 4 — NINK cloud backend (required for average users)

- [ ] `POST /v1/auth/login` — replace email stub
- [ ] `GET /v1/accounting/parameters?user=` — live balance per account
- [ ] `POST /v1/blockchain/anchor` — relayer returns real `transactionHash`
- [ ] Sign-off deducts fee server-side (atomic with anchor)

## Gate 5 — Public network deploy

- [ ] Deploy `ProjectNinkToken` + `NinkRegistry` to target L2 (e.g. Base)
- [ ] Verify both contracts on block explorer
- [ ] Point relayer at production contracts
- [ ] Submit token to explorer token list + CoinGecko / Uniswap list (post-audit)

## Gate 6 — End-to-end sign-off (all modes)

- [ ] Account mode: login → sign-off → viewer (no MetaMask)
- [ ] Wallet mode: connect → approve → anchor → viewer
- [ ] `.nink` envelope contains `transactionHash` + `stateHash`

## Gate 7 — Ops

- [ ] Treasury multisig (not single deployer key)
- [ ] `setAnchorFee` runbook if NINK price moves
- [ ] Monitoring: registry events, failed anchors, RPC health

---

## What local MetaMask problems mean

| Symptom | Launch risk? |
|--------|----------------|
| NINK not visible on Hardhat local | **No** — localhost is dev-only |
| Hardhat console shows correct balance | Token contract OK |
| Extension **Your NINK** panel correct (account mode) | **Primary user UX — required for launch** |
| Extension **On-chain NINK** panel correct (wallet mode) | Required for advanced / audit path |
| Token visible on Base Sepolia explorer + lists | Wallet discovery OK |

**Rule:** Ship when **extension account mode + viewer + relayer API** prove balances and sign-off. Wallet mode is optional for power users.

---

## Next build order

1. **Gate 3** — viewer verification (done in extension UI)
2. **Gate 4** — NINK cloud API skeleton (auth, accounting, anchor)
3. **Gate 5** — Base Sepolia deploy + relayer wired to testnet
4. Buy flow + KYC (after Gate 4)
