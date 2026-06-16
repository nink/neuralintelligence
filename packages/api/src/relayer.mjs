import fs from "node:fs";
import { Contract, JsonRpcProvider, Wallet, id, isHexString } from "ethers";
import { DEPLOYMENT_PATH, RPC_URL, RELAYER_PRIVATE_KEY } from "./constants.mjs";

const REGISTRY_ABI = [
  "function anchorState(bytes32 stateHash)",
  "function anchorFee() view returns (uint256)",
];

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

let relayerReadyPromise = null;

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

function normalizeStateHash(stateHash) {
  const value = String(stateHash || "").trim();
  if (!value) {
    throw new Error("stateHash is required.");
  }

  if (isHexString(value, 32)) {
    return value;
  }

  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    return `0x${value}`;
  }

  throw new Error("stateHash must be a 32-byte hex value.");
}

async function getRelayerClients() {
  const deployment = loadDeployment();
  if (!deployment?.registryAddress || !deployment?.tokenAddress) {
    return null;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(RELAYER_PRIVATE_KEY, provider);
  const registry = new Contract(deployment.registryAddress, REGISTRY_ABI, wallet);
  const token = new Contract(deployment.tokenAddress, TOKEN_ABI, wallet);

  return { deployment, provider, wallet, registry, token };
}

export async function anchorStateOnChain(stateHash) {
  const normalizedHash = normalizeStateHash(stateHash);
  const clients = await getRelayerClients();

  if (!clients) {
    return {
      txHash: id(`offchain-anchor-${normalizedHash}-${Date.now()}`),
      blockNumber: null,
      source: "nink-cloud-api-offchain",
      onChain: false,
    };
  }

  const { registry, token, wallet } = clients;
  const fee = await registry.anchorFee();
  const allowance = await token.allowance(wallet.address, await registry.getAddress());

  if (allowance < fee) {
    const approveTx = await token.approve(await registry.getAddress(), fee);
    await approveTx.wait();
  }

  const tx = await registry.anchorState(normalizedHash);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    source: "nink-cloud-relayer",
    onChain: true,
  };
}

export async function warmRelayer() {
  if (!relayerReadyPromise) {
    relayerReadyPromise = (async () => {
      const clients = await getRelayerClients();
      if (!clients) {
        return { ready: false, reason: "No deployment JSON — off-chain anchors only." };
      }

      try {
        await clients.provider.getBlockNumber();
        return {
          ready: true,
          relayer: clients.wallet.address,
          registry: clients.deployment.registryAddress,
        };
      } catch (error) {
        return { ready: false, reason: error.message };
      }
    })();
  }

  return relayerReadyPromise;
}
