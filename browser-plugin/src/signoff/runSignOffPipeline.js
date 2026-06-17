import { hasSufficientBalance, formatTokenForDisplay } from "../utils/tokenMath.js";
import {
  encryptManifest,
  computeStateHash,
  generateLocalKey,
  exportKeyAsBase64,
  bufferToBase64,
} from "../utils/cryptoEngine.js";
import { createMockAnchorReceipt } from "../utils/devStubs.js";
import { TabVideoRecorder } from "../content/videoRecorder.js";
import {
  ensureScraperReadyOnTab,
  getChatTabById,
  isSupportedChatTab,
} from "../utils/chatTab.js";

import {
  anchorSessionToLedger,
  resolvePlatformIdFromTab,
} from "../utils/web3Bridge.js";
import { NINK_CHAIN_CONFIG } from "../config/chainConfig.js";
import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { getOnChainWalletSnapshot, readChainHealth } from "../utils/tokenBalance.js";
import { applyBalanceAfterAnchor, anchorOnCloudApi } from "../utils/accountingApi.js";

function readLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (stored) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(stored);
    });
  });
}

function readInjectionFailure(injectionResults) {
  const frameResult = injectionResults?.[0];
  if (!frameResult) {
    return "Capture returned no session data from the chat tab.";
  }

  if (frameResult.error) {
    return String(frameResult.error);
  }

  const wrapped = frameResult.result;
  if (!wrapped || typeof wrapped !== "object") {
    return "Capture returned no session data from the chat tab.";
  }

  if (wrapped.ok === false) {
    return wrapped.error || "Capture failed in the chat tab.";
  }

  if (wrapped.ok !== true || !wrapped.data || typeof wrapped.data !== "object") {
    return "Capture returned no session data from the chat tab.";
  }

  return null;
}

async function captureSessionFromTab(tab) {
  const expectedBuild = chrome.runtime.getManifest().version;

  const ready = await ensureScraperReadyOnTab(tab.id, expectedBuild);
  if (!ready.ok) {
    throw new Error(ready.message || "Capture is not ready on this tab yet.");
  }

  let injectionResults;

  try {
    injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (expectedBuild) => {
        try {
          const scrape = globalThis.__NINK_scrapeChatSession__;
          if (typeof scrape !== "function") {
            return {
              ok: false,
              error:
                "Capture is not ready on this tab yet. Refresh your chat tab once, then try sign-off again.",
            };
          }

          const data = await scrape();
          const payload = data && typeof data === "object" ? data : {};
          if (
            Number(payload.captureSchemaVersion) < 7 ||
            payload.captureBuild !== expectedBuild
          ) {
            return {
              ok: false,
              error:
                `Stale capture code loaded (schema ${payload.captureSchemaVersion ?? "?"}, build ${payload.captureBuild ?? "missing"}, need ${expectedBuild}). Reload the extension at chrome://extensions and try again.`,
            };
          }
          const conversation = Array.isArray(payload.conversation)
            ? payload.conversation
            : [];
          const sessionImages = Array.isArray(payload.sessionImages)
            ? payload.sessionImages
            : [];
          const sessionVideos = Array.isArray(payload.sessionVideos)
            ? payload.sessionVideos
            : [];
          const sessionDocuments = Array.isArray(payload.sessionDocuments)
            ? payload.sessionDocuments
            : [];

          if (!conversation.length) {
            return {
              ok: false,
              error:
                "No chat messages matched current selectors. Open an active conversation and try again.",
            };
          }

          return {
            ok: true,
            data: {
              ...payload,
              conversation,
              sessionImages,
              sessionVideos,
              sessionDocuments,
              messageCount: conversation.length,
              imageCount: sessionImages.length,
              videoCount: sessionVideos.length,
              documentCount: sessionDocuments.length,
            },
          };
        } catch (error) {
          return {
            ok: false,
            error: error?.message || String(error),
          };
        }
      },
      args: [expectedBuild],
    });
  } catch (error) {
    throw new Error(
      error?.message ||
        "Could not capture this chat tab. Switch to your conversation tab and try again."
    );
  }

  const injectionFailure = readInjectionFailure(injectionResults);
  if (injectionFailure) {
    throw new Error(injectionFailure);
  }

  return normalizeCapturedSession(injectionResults[0].result.data);
}

function normalizeCapturedSession(sessionData) {
  if (!sessionData || typeof sessionData !== "object") {
    throw new Error("Capture returned no session data from the chat tab.");
  }

  const sessionImages = Array.isArray(sessionData.sessionImages)
    ? sessionData.sessionImages
    : [];
  const sessionVideos = Array.isArray(sessionData.sessionVideos)
    ? sessionData.sessionVideos
    : [];
  const sessionDocuments = Array.isArray(sessionData.sessionDocuments)
    ? sessionData.sessionDocuments
    : [];
  const conversation = Array.isArray(sessionData.conversation)
    ? sessionData.conversation
    : [];

  return {
    ...sessionData,
    conversation,
    captureSchemaVersion: sessionData.captureSchemaVersion ?? 2,
    sessionImages,
    sessionVideos,
    sessionDocuments,
    messageCount: conversation.length,
    imageCount: sessionImages.length,
    videoCount: sessionVideos.length,
    documentCount: sessionDocuments.length,
    imageDiscovery: sessionData.imageDiscovery ?? {
      containersScanned: 0,
      targetsFound: sessionImages.length,
      mainImageCount: 0,
      successfulCaptures: sessionImages.filter(
        (image) => image.captureStatus === "success"
      ).length,
      note: "imageDiscovery missing from content script — reload extension",
    },
    documentDiscovery: sessionData.documentDiscovery ?? {
      targetsFound: sessionDocuments.length,
      documentsReferenced: sessionDocuments.filter(
        (document) =>
          document.captureStatus === "success" ||
          document.captureStatus === "metadata-only"
      ).length,
    },
  };
}

function downloadViaExtension(filename, blob, saveAs = true) {
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs,
        conflictAction: "uniquify",
      },
      (downloadId) => {
        URL.revokeObjectURL(url);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(downloadId);
      }
    );
  });
}

function waitForDownloadItem(downloadId) {
  return new Promise((resolve, reject) => {
    function finishWithItem(item) {
      if (!item) {
        reject(new Error("Download not found."));
        return;
      }

      if (item.state === "complete") {
        resolve(item);
        return;
      }

      if (item.state === "interrupted") {
        reject(new Error("Download was cancelled or failed."));
      }
    }

    function onChanged(delta) {
      if (delta.id !== downloadId) {
        return;
      }

      if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(onChanged);
        chrome.downloads.search({ id: downloadId }, (items) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          finishWithItem(items[0]);
        });
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);

    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError) {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const item = items[0];
      if (item?.state === "complete" || item?.state === "interrupted") {
        chrome.downloads.onChanged.removeListener(onChanged);
        finishWithItem(item);
      }
    });
  });
}

function getKeyFilenameForArchiveFilename(archiveFilename) {
  const normalized = String(archiveFilename || "")
    .trim()
    .replace(/\\/g, "/");
  const baseName = normalized.split("/").pop() || normalized;

  if (/\.nink$/i.test(baseName)) {
    return baseName.replace(/\.nink$/i, ".ninkkey");
  }

  const stem = baseName.replace(/\.[^./\\]+$/, "") || baseName;
  return `${stem}.ninkkey`;
}

export async function triggerNinkSignOffDownloads(completedPackage, aesKeyBase64) {
  if (!completedPackage?.encryptedPayload) {
    throw new Error("encryptedPayload missing from export package.");
  }

  if (!aesKeyBase64) {
    throw new Error("AES key missing from export package.");
  }

  const suggestedNinkFilename = `nink-session-${Date.now()}.nink`;

  const archiveBlob = new Blob([JSON.stringify(completedPackage, null, 2)], {
    type: "application/octet-stream",
  });
  const keyBlob = new Blob([aesKeyBase64], { type: "application/octet-stream" });

  const archiveDownloadId = await downloadViaExtension(suggestedNinkFilename, archiveBlob, true);
  const archiveDownload = await waitForDownloadItem(archiveDownloadId);
  const savedNinkFilename = archiveDownload.filename || suggestedNinkFilename;
  const keyFilename = getKeyFilenameForArchiveFilename(savedNinkFilename);

  await downloadViaExtension(keyFilename, keyBlob, true);

  return {
    ninkFilename: savedNinkFilename,
    keyFilename,
  };
}

async function resolveAnchorReceipt(stateHash, appliedFee, useDevStubs, config, session) {
  if (useDevStubs) {
    return createMockAnchorReceipt();
  }

  const payload = await anchorOnCloudApi(config, session, stateHash, appliedFee);
  await applyBalanceAfterAnchor(payload.balance, appliedFee);

  return {
    txHash: payload.txHash,
    blockNumber: payload.blockNumber ?? null,
    source: payload.source || "nink-cloud-api",
    isLocalDevMode: false,
    onChain: payload.onChain ?? false,
    balanceAfter: payload.balance,
  };
}

export async function validateSignOffReady(useDevStubs, chatTabId) {
  const stored = await readLocalStorage([
    "accounting",
    "connectedWallet",
    "ninkConfig",
    "ninkSession",
  ]);
  const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
  const useWalletMode = Boolean(config.useWalletMode);
  const accounting = stored.accounting;
  const connectedAddress = stored.connectedWallet?.address || null;

  const tab = await getChatTabById(chatTabId);
  if (!isSupportedChatTab(tab)) {
    throw new Error(
      "Open a supported AI chat tab (ChatGPT, Gemini, Claude, Grok, Perplexity, Copilot, etc.) before sign-off."
    );
  }

  if (useDevStubs) {
    if (!accounting) {
      throw new Error("Accounting data not ready. Close and reopen the popup.");
    }
    if (!hasSufficientBalance(accounting.userBalance, accounting.requiredFee)) {
      throw new Error(
        `Insufficient funds. Required: ${formatTokenForDisplay(accounting.requiredFee)}, Available: ${formatTokenForDisplay(accounting.userBalance)}`
      );
    }
    return { tab, connectedAddress: null, useWalletMode: false };
  }

  if (useWalletMode) {
    if (!connectedAddress) {
      throw new Error("Connect your wallet before sign-off.");
    }

    const health = await readChainHealth();
    if (!health.ok) {
      throw new Error(
        health.reason === "rpc-unreachable" || health.reason?.includes("fetch")
          ? "Local Hardhat chain is not running. Start: npx hardhat node"
          : `Local chain not ready (${health.reason || "unknown"}). Redeploy contracts.`
      );
    }

    const snapshot = await getOnChainWalletSnapshot(connectedAddress);
    if (!snapshot.ok || !hasSufficientBalance(snapshot.balanceWei, snapshot.anchorFeeWei)) {
      throw new Error(
        `Insufficient on-chain NINK. Required: ${snapshot.anchorFeeFormatted || "?"} NINK, Available: ${snapshot.balanceFormatted || "0"} NINK`
      );
    }

    return { tab, connectedAddress, useWalletMode: true };
  }

  if (!stored.ninkSession?.userId) {
    throw new Error("Sign in to your NINK account first.");
  }

  if (!accounting) {
    throw new Error("Balance not loaded yet. Wait a moment and try again.");
  }

  if (!hasSufficientBalance(accounting.userBalance, accounting.requiredFee)) {
    throw new Error(
      `Insufficient NINK. Required: ${formatTokenForDisplay(accounting.requiredFee)}, Available: ${formatTokenForDisplay(accounting.userBalance)}`
    );
  }

  return { tab, connectedAddress: null, useWalletMode: false };
}

export async function executeSignOff(useDevStubs, chatTabId, onStatus) {
  const { tab, connectedAddress, useWalletMode } = await validateSignOffReady(
    useDevStubs,
    chatTabId
  );
  const stored = await readLocalStorage(["accounting", "ninkSession", "ninkConfig"]);
  const accounting = stored.accounting;
  const ninkConfig = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };

  if (useWalletMode) {
    onStatus?.(
      "Keep this window open. Confirm each MetaMask prompt on your chat tab (approve, then anchor)…"
    );
  } else if (useDevStubs) {
    onStatus?.("Capturing and encrypting session…");
  } else {
    onStatus?.("Capturing and encrypting session… NINK cloud will anchor when ready.");
  }

  const tabVideoRecorder = new TabVideoRecorder();
  let videoCaptureError = null;

  try {
    await tabVideoRecorder.start(tab.id);
  } catch (error) {
    videoCaptureError = error;
    console.warn("Tab video capture unavailable:", error);
  }

  let sessionData;
  let captureError = null;

  try {
    sessionData = await captureSessionFromTab(tab);
  } catch (error) {
    captureError = error;
  } finally {
    if (tabVideoRecorder.isRecording()) {
      try {
        const videoResult = await tabVideoRecorder.stop();
        if (videoResult?.base64 && sessionData) {
          sessionData.capturedVideo = videoResult.base64;
          sessionData.capturedVideoMime = videoResult.mimeType;
          sessionData.capturedVideoSlices = videoResult.sliceCount;
        }
      } catch (error) {
        if (!videoCaptureError) {
          videoCaptureError = error;
        }
      }
    }
  }

  if (captureError) {
    throw captureError;
  }

  sessionData = normalizeCapturedSession(sessionData);
  sessionData.captureTab = {
    url: tab.url || null,
    title: tab.title || null,
    capturedAt: new Date().toISOString(),
  };

  if (sessionData.auditRecord?.sessionContext) {
    sessionData.auditRecord.sessionContext.sessionUrl =
      tab.url || sessionData.auditRecord.sessionContext.sessionUrl;
    if (tab.title && !sessionData.auditRecord.sessionContext.sessionTitle) {
      sessionData.auditRecord.sessionContext.sessionTitle = tab.title;
    }
  }

  sessionData.signOffContext = {
    feeApplied: accounting.requiredFee,
    balanceAtSignOff: accounting.userBalance,
    accountingSource: accounting.source || null,
    isLocalDevMode: Boolean(useDevStubs || accounting.isLocalDevMode),
    anchorProofLocation: "outer-envelope",
  };

  onStatus?.("Encrypting session payload…");

  const localKey = await generateLocalKey();
  const aesKeyBase64 = await exportKeyAsBase64(localKey);
  const encryptedBytes = await encryptManifest(sessionData, localKey);
  const stateHash = await computeStateHash(encryptedBytes);
  const encryptedPayload = bufferToBase64(encryptedBytes);

  if (!encryptedPayload) {
    throw new Error("Encrypted payload generation failed.");
  }

  const platformId = resolvePlatformIdFromTab(tab.url, sessionData.sourcePlatform);
  const anchorTimestamp = Math.floor(Date.now() / 1000);
  let chainReceipt;

  if (useDevStubs) {
    chainReceipt = await resolveAnchorReceipt(
      stateHash,
      accounting.requiredFee,
      useDevStubs,
      ninkConfig,
      stored.ninkSession
    );
    const debitedBalance = (
      BigInt(accounting.userBalance) - BigInt(accounting.requiredFee)
    ).toString();
    await applyBalanceAfterAnchor(
      debitedBalance,
      accounting.requiredFee,
      "local-dev-stubs"
    );
    sessionData.signOffContext.identityProofAddress = "0xUserWallet";
    sessionData.signOffContext.anchorMethod = chainReceipt.source || "local-dev-fallback";
  } else if (useWalletMode) {
    onStatus?.("Waiting for MetaMask on your chat tab…");
    const anchorResult = await anchorSessionToLedger(
      stateHash,
      platformId,
      anchorTimestamp,
      tab.id,
      { connectedAddress }
    );
    chainReceipt = {
      txHash: anchorResult.transactionHash,
      blockNumber: anchorResult.blockNumber,
      registryAddress: anchorResult.registryAddress,
      validatorAddress: anchorResult.validatorAddress,
      chainId: anchorResult.chainId,
      source: anchorResult.anchorMethod || "metamask-tab",
      isLocalDevMode: false,
    };
    sessionData.signOffContext.identityProofAddress = anchorResult.validatorAddress;
    sessionData.signOffContext.anchorMethod = anchorResult.anchorMethod || "metamask-tab";
    sessionData.signOffContext.onChainTransactionHash = anchorResult.transactionHash;
    sessionData.signOffContext.registryAddress = anchorResult.registryAddress;
    sessionData.signOffContext.platformId = platformId;
    sessionData.signOffContext.anchorTimestamp = anchorTimestamp;
  } else {
    onStatus?.("Anchoring via NINK cloud…");
    const receipt = await resolveAnchorReceipt(
      stateHash,
      accounting.requiredFee,
      false,
      ninkConfig,
      stored.ninkSession
    );
    chainReceipt = {
      txHash: receipt.txHash,
      blockNumber: receipt.blockNumber ?? null,
      registryAddress: NINK_CHAIN_CONFIG.registryAddress || null,
      validatorAddress: stored.ninkSession?.userId || "nink-account",
      chainId: NINK_CHAIN_CONFIG.chainId ?? null,
      source: receipt.source || "nink-cloud-relayer",
      isLocalDevMode: false,
    };
    sessionData.signOffContext.identityProofAddress = stored.ninkSession?.userId || "nink-account";
    sessionData.signOffContext.anchorMethod = receipt.source || "nink-cloud-relayer";
    sessionData.signOffContext.onChainTransactionHash = receipt.txHash;
    sessionData.signOffContext.registryAddress = NINK_CHAIN_CONFIG.registryAddress || null;
    sessionData.signOffContext.platformId = platformId;
    sessionData.signOffContext.anchorTimestamp = anchorTimestamp;
  }

  const anchoredAt = new Date().toISOString();
  sessionData.signOffContext.anchoredAt = anchoredAt;
  sessionData.signOffContext.stateHash = stateHash;

  if (sessionData.auditRecord) {
    sessionData.auditRecord.signOffContext = sessionData.signOffContext;
    if (sessionData.auditRecord.interactionSummary) {
      sessionData.auditRecord.interactionSummary += ` Signed off at ${anchoredAt}.`;
    }
  }

  const sessionImages = Array.isArray(sessionData.sessionImages)
    ? sessionData.sessionImages
    : [];
  const sessionVideos = Array.isArray(sessionData.sessionVideos)
    ? sessionData.sessionVideos
    : [];
  const sessionDocuments = Array.isArray(sessionData.sessionDocuments)
    ? sessionData.sessionDocuments
    : [];
  const imagesCaptured = sessionImages.filter(
    (image) => image.captureStatus === "success"
  ).length;
  const chatVideosCaptured = sessionVideos.filter(
    (video) => video.captureStatus === "success"
  ).length;
  const chatVideosReferenced = sessionVideos.filter(
    (video) =>
      video.captureStatus === "success" || video.captureStatus === "metadata-only"
  ).length;
  const documentsCaptured = sessionDocuments.filter(
    (document) => document.captureStatus === "success"
  ).length;
  const documentsReferenced = sessionDocuments.filter(
    (document) =>
      document.captureStatus === "success" || document.captureStatus === "metadata-only"
  ).length;

  return {
    completedPackage: {
      version: `NINK-V${chrome.runtime.getManifest().version}`,
      blockchainNetwork: useDevStubs
        ? "Base-Sepolia-Mock"
        : useWalletMode
          ? `chain-${chainReceipt.chainId ?? NINK_CHAIN_CONFIG.chainId ?? "unknown"}`
          : "NINK-Cloud",
      timestamp: anchoredAt,
      sourcePlatform: sessionData.sourcePlatform,
      platformId,
      anchorMethod: chainReceipt.source || (useDevStubs ? "local-dev-fallback" : "metamask-tab"),
      registryAddress: chainReceipt.registryAddress || NINK_CHAIN_CONFIG.registryAddress || null,
      validatorAddress:
        chainReceipt.validatorAddress || sessionData.signOffContext.identityProofAddress || null,
      blockNumber: chainReceipt.blockNumber ?? null,
      transactionHash: chainReceipt.txHash,
      stateHash,
      payloadCompression: "gzip",
      encryptedPayload,
    },
    messageCount: sessionData.messageCount,
    imagesCaptured,
    imageCount: sessionImages.length,
    chatVideosCaptured,
    chatVideosReferenced,
    chatVideoCount: sessionVideos.length,
    documentsCaptured,
    documentsReferenced,
    documentCount: sessionDocuments.length,
    videoCaptured: Boolean(sessionData.capturedVideo),
    videoCaptureError: videoCaptureError?.message || null,
    imageDiscovery: sessionData.imageDiscovery,
    scrollDiscovery: sessionData.scrollDiscovery,
    documentDiscovery: sessionData.documentDiscovery,
    captureSchemaVersion: sessionData.captureSchemaVersion ?? 0,
    captureBuild: sessionData.captureBuild ?? "",
    isLocalDevMode: Boolean(useDevStubs || chainReceipt.isLocalDevMode),
    aesKeyBase64,
  };
}

export function buildSignOffSuccessMessage(result, ninkFilename, keyFilename) {
  const devLabel = result.isLocalDevMode ? " [Local Dev Mode]" : "";
  const discoveryHint =
    result.imageCount === 0 && result.imageDiscovery?.mainImageCount > 0
      ? " · scroll chat and retry (images visible but not captured)"
      : result.imageCount === 0
        ? " · no images packaged"
        : "";
  const buildLabel = result.captureBuild ? ` · build ${result.captureBuild}` : "";

  return (
    `Saved ${ninkFilename} + ${keyFilename}${devLabel}! Hash: ${(result.completedPackage.stateHash || "").substring(0, 10)}...` +
    (result.messageCount ? ` · ${result.messageCount} messages` : "") +
    ` · ${result.imagesCaptured ?? 0}/${result.imageCount ?? 0} images` +
    discoveryHint +
    buildLabel
  );
}
