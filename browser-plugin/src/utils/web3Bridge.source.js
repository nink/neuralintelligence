import { NINK_CHAIN_CONFIG } from "../config/chainConfig.js";
import {
  anchorViaLocalRpc,
  isLocalHardhatChain,
} from "./localChainAnchor.source.js";
import { normalizeStateHashHex } from "./stateHash.js";

export { normalizeStateHashHex } from "./stateHash.js";

export async function anchorSessionToLedger(
  stateHashHex,
  platformId,
  timestamp,
  _tabId
) {
  if (
    !NINK_CHAIN_CONFIG.registryAddress ||
    NINK_CHAIN_CONFIG.registryAddress ===
      "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(
      "Registry contract address is not configured. Run packages/contracts deploy script against your local chain."
    );
  }

  const stateHash = normalizeStateHashHex(stateHashHex);
  const numericPlatformId = Number(platformId) >>> 0;
  const numericTimestamp = Math.floor(Number(timestamp));

  let walletResult;

  if (isLocalHardhatChain()) {
    walletResult = await anchorViaLocalRpc(stateHash);
  } else {
    throw new Error(
      "Production wallet anchoring is not enabled in this build. Use local Hardhat chain or turn Mock mode on."
    );
  }

  const transactionHash =
    walletResult?.transactionHash && String(walletResult.transactionHash).trim();

  if (!transactionHash || transactionHash === "null") {
    throw new Error(
      "Anchor transaction completed without a transaction hash. Wallet response: " +
        JSON.stringify(walletResult)
    );
  }

  return {
    transactionHash,
    blockNumber: walletResult.blockNumber ?? null,
    validatorAddress: walletResult.validatorAddress,
    registryAddress: walletResult.registryAddress || NINK_CHAIN_CONFIG.registryAddress,
    chainId: walletResult.chainId,
    platformId: numericPlatformId,
    timestamp: numericTimestamp,
    stateHash,
    anchorMethod: walletResult.anchorMethod || "local-rpc-signer",
  };
}

export { resolvePlatformIdFromTab } from "./platformIds.js";
