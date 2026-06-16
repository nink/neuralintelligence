import { NINK_CHAIN_CONFIG } from "../config/chainConfig.js";
import { formatTokenForDisplay } from "./tokenMath.js";

/** Hardhat account #0 — local dev signer shown when MetaMask address unavailable. */
export const LOCAL_DEV_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const LOCAL_HARDHAT_CHAIN_ID = 31337;
const LOCAL_RPC_URL = "http://127.0.0.1:8545";

function strip0x(hex) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase();
}

function padAddress(address) {
  return strip0x(address).padStart(64, "0");
}

async function rpcCall(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "RPC error");
  }

  return payload.result;
}

function decodeUint256(hex) {
  if (!hex || hex === "0x") {
    return 0n;
  }
  return BigInt(hex);
}

export function resolveRpcUrl() {
  if (Number(NINK_CHAIN_CONFIG.chainId) === LOCAL_HARDHAT_CHAIN_ID) {
    return LOCAL_RPC_URL;
  }
  return NINK_CHAIN_CONFIG.rpcUrl || "";
}

export async function readNinkBalance(walletAddress, rpcUrl = resolveRpcUrl()) {
  if (!NINK_CHAIN_CONFIG.tokenAddress || !walletAddress || !rpcUrl) {
    return null;
  }

  const data = `0x70a08231${padAddress(walletAddress)}`;
  const result = await rpcCall(rpcUrl, "eth_call", [
    { to: NINK_CHAIN_CONFIG.tokenAddress, data },
    "latest",
  ]);

  return decodeUint256(result);
}

export async function readAnchorFee(rpcUrl = resolveRpcUrl()) {
  if (!NINK_CHAIN_CONFIG.registryAddress || !rpcUrl) {
    return null;
  }

  const data = "0x919acbe6"; // anchorFee()
  const result = await rpcCall(rpcUrl, "eth_call", [
    { to: NINK_CHAIN_CONFIG.registryAddress, data },
    "latest",
  ]);

  return decodeUint256(result);
}

export async function readChainHealth(rpcUrl = resolveRpcUrl()) {
  if (!rpcUrl) {
    return { ok: false, reason: "rpc-not-configured" };
  }

  try {
    const chainIdHex = await rpcCall(rpcUrl, "eth_chainId");
    const chainId = Number.parseInt(chainIdHex, 16);
    const expected = Number(NINK_CHAIN_CONFIG.chainId);

    if (expected && chainId !== expected) {
      return { ok: false, reason: "chain-id-mismatch", chainId, expected };
    }

    if (NINK_CHAIN_CONFIG.tokenAddress) {
      const code = await rpcCall(rpcUrl, "eth_getCode", [
        NINK_CHAIN_CONFIG.tokenAddress,
        "latest",
      ]);
      if (!code || code === "0x") {
        return { ok: false, reason: "token-not-deployed", chainId };
      }
    }

    if (NINK_CHAIN_CONFIG.registryAddress) {
      const registryCode = await rpcCall(rpcUrl, "eth_getCode", [
        NINK_CHAIN_CONFIG.registryAddress,
        "latest",
      ]);
      if (!registryCode || registryCode === "0x") {
        return { ok: false, reason: "registry-not-deployed", chainId };
      }
    }

    return { ok: true, chainId };
  } catch (error) {
    return { ok: false, reason: error.message || "rpc-unreachable" };
  }
}

export async function getOnChainWalletSnapshot(walletAddress) {
  const rpcUrl = resolveRpcUrl();
  const health = await readChainHealth(rpcUrl);

  if (!health.ok) {
    return {
      ok: false,
      health,
      rpcUrl,
      walletAddress: walletAddress || null,
    };
  }

  const targetWallet = walletAddress || LOCAL_DEV_WALLET;
  const [balanceWei, anchorFeeWei] = await Promise.all([
    readNinkBalance(targetWallet, rpcUrl),
    readAnchorFee(rpcUrl),
  ]);

  return {
    ok: true,
    health,
    rpcUrl,
    walletAddress: targetWallet,
    tokenAddress: NINK_CHAIN_CONFIG.tokenAddress,
    registryAddress: NINK_CHAIN_CONFIG.registryAddress,
    balanceWei: balanceWei?.toString() ?? "0",
    balanceFormatted: formatTokenForDisplay(balanceWei?.toString() ?? "0"),
    anchorFeeWei: anchorFeeWei?.toString() ?? NINK_CHAIN_CONFIG.anchorFeeWei ?? "0",
    anchorFeeFormatted: formatTokenForDisplay(
      anchorFeeWei?.toString() ?? NINK_CHAIN_CONFIG.anchorFeeWei ?? "0"
    ),
    source: "on-chain-rpc",
  };
}
