import { Contract, JsonRpcProvider, MaxUint256, Wallet } from "ethers";
import {
  NINK_CHAIN_CONFIG,
  NINK_REGISTRY_ABI,
  NINK_TOKEN_ABI,
} from "../config/chainConfig.js";
import { normalizeStateHashHex } from "./stateHash.js";

/** Public Hardhat account #0 — local chain only, never use on mainnet. */
const LOCAL_DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const LOCAL_HARDHAT_CHAIN_ID = 31337;
export const LOCAL_RPC_URL = "http://127.0.0.1:8545";

let anchorLock = Promise.resolve();

export function isLocalHardhatChain() {
  return Number(NINK_CHAIN_CONFIG.chainId) === LOCAL_HARDHAT_CHAIN_ID;
}

async function rpcCall(method, params = []) {
  const response = await fetch(LOCAL_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`Local chain RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "Local chain RPC error");
  }

  return payload.result;
}

export async function ensureLocalChainReady() {
  const chainIdHex = await rpcCall("eth_chainId");
  const chainId = parseInt(chainIdHex, 16);

  if (chainId !== LOCAL_HARDHAT_CHAIN_ID) {
    throw new Error(
      `Local Hardhat node responded with chain ${chainId}, expected ${LOCAL_HARDHAT_CHAIN_ID}.`
    );
  }

  for (const [label, address] of [
    ["token", NINK_CHAIN_CONFIG.tokenAddress],
    ["registry", NINK_CHAIN_CONFIG.registryAddress],
  ]) {
    const code = await rpcCall("eth_getCode", [address, "latest"]);
    if (!code || code === "0x") {
      throw new Error(
        `NINK ${label} is not deployed on the local chain. Run: npx hardhat run scripts/deploy.js --network localhost`
      );
    }
  }

  return { chainId, registryAddress: NINK_CHAIN_CONFIG.registryAddress };
}

function isNonceError(error) {
  const message = String(error?.message || error?.shortMessage || "");
  return (
    error?.code === "NONCE_EXPIRED" ||
    /nonce too low/i.test(message) ||
    /nonce has already been used/i.test(message)
  );
}

async function pendingNonce(provider, address) {
  return provider.getTransactionCount(address, "pending");
}

async function runLocalAnchor(stateHashHex) {
  await ensureLocalChainReady();

  const stateHash = normalizeStateHashHex(stateHashHex);
  const provider = new JsonRpcProvider(LOCAL_RPC_URL, LOCAL_HARDHAT_CHAIN_ID);
  const signer = new Wallet(LOCAL_DEV_PRIVATE_KEY, provider);
  const token = new Contract(NINK_CHAIN_CONFIG.tokenAddress, NINK_TOKEN_ABI, signer);
  const registry = new Contract(
    NINK_CHAIN_CONFIG.registryAddress,
    NINK_REGISTRY_ABI,
    signer
  );

  const anchorFee = await registry.anchorFee();
  const allowance = await token.allowance(
    signer.address,
    NINK_CHAIN_CONFIG.registryAddress
  );

  async function sendAnchorFlow() {
    if (allowance < anchorFee) {
      const approveNonce = await pendingNonce(provider, signer.address);
      const approveTx = await token.approve(NINK_CHAIN_CONFIG.registryAddress, MaxUint256, {
        nonce: approveNonce,
      });
      await approveTx.wait();
    }

    const anchorNonce = await pendingNonce(provider, signer.address);
    const anchorTx = await registry.anchorState(stateHash, { nonce: anchorNonce });
    return anchorTx.wait();
  }

  let receipt;
  try {
    receipt = await sendAnchorFlow();
  } catch (error) {
    if (!isNonceError(error)) {
      throw error;
    }
    receipt = await sendAnchorFlow();
  }

  if (!receipt?.hash) {
    throw new Error("Local anchor transaction completed without a hash.");
  }

  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    validatorAddress: signer.address,
    registryAddress: NINK_CHAIN_CONFIG.registryAddress,
    chainId: LOCAL_HARDHAT_CHAIN_ID,
    anchorMethod: "local-rpc-signer",
    anchorFeePaid: anchorFee.toString(),
  };
}

export async function anchorViaLocalRpc(stateHashHex) {
  let releaseLock;
  const previousLock = anchorLock;
  anchorLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await previousLock;

  try {
    return await runLocalAnchor(stateHashHex);
  } finally {
    releaseLock();
  }
}
