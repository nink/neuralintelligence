# Smart contracts (Hardhat)

Production **Project NINK** ERC-20 token and **NinkRegistry** anchoring contract (OpenZeppelin v5).

| Contract | Purpose |
|----------|---------|
| `ProjectNinkToken.sol` | Fixed 100M NINK supply, 18 decimals, minted once to deployer |
| `NinkRegistry.sol` | Fee-based `anchorState(bytes32)` with owner-configurable `anchorFee` |
| `NinkAnchorRegistry.sol` | Legacy dev registry (unchanged) |

## Setup

```powershell
cd packages/contracts
npm install
```

## Test

```powershell
npx hardhat test
```

## Local chain loop

Terminal 1:

```powershell
npx hardhat node
```

Terminal 2:

```powershell
npx hardhat run scripts/deploy.js --network localhost
```

This writes:

- `deployments/<chainId>.json`
- `browser-plugin/src/config/chainConfig.js` (registry address + ABI)

Terminal 3 — rebuild Web3 bridge bundle:

```powershell
cd browser-plugin
npm install
npm run build:web3
```

Load the extension from `browser-plugin/`, disable **Local test mode**, connect MetaMask to `Localhost 8545`, and sign-off.

## Networks

Copy `.env.example` to `.env` and set `BASE_SEPOLIA_RPC_URL` + `DEPLOYER_PRIVATE_KEY` for testnet deploys.
