import { Interface, MaxUint256 } from "ethers";
import {
  NINK_CHAIN_CONFIG,
  NINK_REGISTRY_ABI,
  NINK_TOKEN_ABI,
} from "../config/chainConfig.js";
import {
  isLocalHardhatChain,
} from "./localChainAnchor.source.js";
import { anchorViaActiveTab } from "./walletInject.js";
import { readAnchorFee, readNinkAllowance } from "./tokenBalance.js";
import { normalizeStateHashHex } from "./stateHash.js";

export { normalizeStateHashHex } from "./stateHash.js";

async function anchorViaMetaMask(tabId, stateHash, connectedAddress) {
  const anchorFee = (await readAnchorFee()) ?? 0n;
  const allowance =
    (await readNinkAllowance(connectedAddress, NINK_CHAIN_CONFIG.registryAddress)) ?? 0n;

  const tokenIface = new Interface(NINK_TOKEN_ABI);
  const registryIface = new Interface(NINK_REGISTRY_ABI);

  const injectionArgs = {
    expectedChainId: Number(NINK_CHAIN_CONFIG.chainId),
    tokenAddress: NINK_CHAIN_CONFIG.tokenAddress,
    registryAddress: NINK_CHAIN_CONFIG.registryAddress,
    anchorCallData: registryIface.encodeFunctionData("anchorState", [stateHash]),
    approveCallData:
      allowance < anchorFee
        ? tokenIface.encodeFunctionData("approve", [
            NINK_CHAIN_CONFIG.registryAddress,
            MaxUint256,
          ])
        : null,
  };

  const walletResult = await anchorViaActiveTab(tabId, injectionArgs);

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
    validatorAddress: walletResult.validatorAddress || connectedAddress,
    registryAddress: walletResult.registryAddress || NINK_CHAIN_CONFIG.registryAddress,
    chainId: walletResult.chainId ?? Number(NINK_CHAIN_CONFIG.chainId),
    anchorMethod: "metamask-tab",
    anchorFeePaid: anchorFee.toString(),
  };
}

export async function anchorSessionToLedger(
  stateHashHex,
  platformId,
  timestamp,
  tabId,
  options = {}
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
  const connectedAddress = options.connectedAddress || null;

  let walletResult;

  if (connectedAddress && tabId) {
    walletResult = await anchorViaMetaMask(tabId, stateHash, connectedAddress);
  } else if (isLocalHardhatChain()) {
    throw new Error("Connect your wallet before sign-off.");
  } else {
    throw new Error(
      "Connect your wallet to sign off on-chain. Production network anchoring requires a connected wallet."
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
    anchorMethod: walletResult.anchorMethod || "metamask-tab",
  };
}

export { resolvePlatformIdFromTab } from "./platformIds.js";
