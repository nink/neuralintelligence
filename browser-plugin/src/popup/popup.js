import { hasSufficientBalance, formatTokenForDisplay } from "../utils/tokenMath.js";
import {
  encryptManifest,
  computeStateHash,
  generateLocalKey,
  exportKeyAsBase64,
  bufferToBase64,
} from "../utils/cryptoEngine.js";
import { createMockAnchorReceipt, LOCAL_DEV_ACCOUNTING } from "../utils/devStubs.js";
import { TabVideoRecorder } from "../content/videoRecorder.js";
import { isSupportedChatUrl } from "../config/chatPlatforms.js";

const CONTENT_SCRIPT_PATHS = [
  "src/config/chatPlatforms.global.js",
  "src/content/scrapers.js",
];

function setLocalDevModeIndicator(isLocalDevMode) {
  const badge = document.getElementById("dev-mode-badge");
  badge.hidden = !isLocalDevMode;
}

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

function sendBackgroundMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function getActiveChatTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!tabs[0]?.id) {
        reject(new Error("No active tab available for capture."));
        return;
      }

      resolve(tabs[0]);
    });
  });
}

function isSupportedChatTab(tab) {
  return isSupportedChatUrl(String(tab.url || ""));
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

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      delete globalThis.__NINK_scrapeChatSession__;
      delete globalThis.__NINK_SCRAPER_BUILD__;
    },
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (build) => {
      globalThis.__NINK_SCRAPER_BUILD__ = build;
    },
    args: [expectedBuild],
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: CONTENT_SCRIPT_PATHS,
  });

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
                "NINK scraper is not initialized. Reload the chat tab and try again.",
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
                `Stale capture code loaded (schema ${payload.captureSchemaVersion ?? "?"}, build ${payload.captureBuild ?? "missing"}, need ${expectedBuild}). At chrome://extensions click Remove on NINK, then Load unpacked again and pick the nink-browser-plugin folder.`,
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
            const host = window.location.hostname.replace(/^www\./, "");
            const onGrok =
              host === "grok.com" ||
              host.endsWith(".grok.com") ||
              host === "grok.x.ai";
            const grokHint = onGrok
              ? " Open an active Grok conversation (grok.com/c/…) with messages visible, then retry."
              : "";
            return {
              ok: false,
              error:
                "No chat messages matched current selectors. Open an active conversation and try again." +
                grokHint,
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
        "Content script unavailable. Reload the chat tab, then try again."
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

async function triggerNinkSignOffDownloads(completedPackage, aesKeyBase64) {
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

async function resolveAnchorReceipt(stateHash, appliedFee, useDevStubs) {
  if (useDevStubs) {
    return createMockAnchorReceipt();
  }

  const response = await sendBackgroundMessage({
    action: "ANCHOR_HASH",
    stateHash,
    appliedFee,
  });

  if (!response || response.status !== "SUCCESS") {
    throw new Error(response?.message || "Anchor submission failed.");
  }

  return response.receipt;
}

async function runSignOffInPopup(useDevStubs) {
  const stored = await readLocalStorage(["accounting", "ninkConfig"]);
  const accounting = stored.accounting;

  if (!accounting) {
    throw new Error("Accounting data not ready. Close and reopen the popup.");
  }

  if (!hasSufficientBalance(accounting.userBalance, accounting.requiredFee)) {
    throw new Error(
      `Insufficient funds. Required: ${formatTokenForDisplay(accounting.requiredFee)}, Available: ${formatTokenForDisplay(accounting.userBalance)}`
    );
  }

  const tab = await getActiveChatTab();
  if (!isSupportedChatTab(tab)) {
    throw new Error(
      "Open a supported AI chat tab (ChatGPT, Gemini, Claude, Grok, Perplexity, Copilot, etc.) before sign-off."
    );
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
        videoCaptureError = error;
        console.warn("Tab video compilation failed:", error);
        await tabVideoRecorder.cancel();
      }
    }
  }

  if (captureError) {
    throw captureError;
  }

  if (!sessionData) {
    throw new Error("Capture returned no session data from the chat tab.");
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
    anchoredAt: new Date().toISOString(),
    feeApplied: accounting.requiredFee,
    balanceAtSignOff: accounting.userBalance,
    accountingSource: accounting.source || null,
    identityProofAddress: "0xUserWallet",
    isLocalDevMode: Boolean(useDevStubs || accounting.isLocalDevMode),
    anchorProofLocation: "outer-envelope",
  };

  if (sessionData.auditRecord) {
    sessionData.auditRecord.signOffContext = sessionData.signOffContext;
    if (sessionData.auditRecord.interactionSummary) {
      sessionData.auditRecord.interactionSummary += ` Signed off at ${sessionData.signOffContext.anchoredAt}.`;
    }
  }

  const anchoredAt = new Date().toISOString();

  const localKey = await generateLocalKey();
  const aesKeyBase64 = await exportKeyAsBase64(localKey);
  const encryptedBytes = await encryptManifest(sessionData, localKey);
  const stateHash = await computeStateHash(encryptedBytes);
  const encryptedPayload = bufferToBase64(encryptedBytes);

  if (!encryptedPayload) {
    throw new Error("Encrypted payload generation failed.");
  }

  const chainReceipt = await resolveAnchorReceipt(
    stateHash,
    accounting.requiredFee,
    useDevStubs
  );

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
      blockchainNetwork: useDevStubs ? "Base-Sepolia-Mock" : "Base-Sepolia",
      timestamp: anchoredAt,
      sourcePlatform: sessionData.sourcePlatform,
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

async function updateUI() {
  try {
    const stored = await readLocalStorage(["accounting", "ninkConfig"]);
    const accounting = stored.accounting;
    const useDevStubs = stored.ninkConfig?.useDevStubs !== false;

    document.getElementById("dev-stub-toggle").checked = useDevStubs;

    if (accounting) {
      document.getElementById("balance-display").innerText = formatTokenForDisplay(
        accounting.userBalance
      );
      document.getElementById("fee-display").innerText = formatTokenForDisplay(
        accounting.requiredFee
      );
    }

    setLocalDevModeIndicator(useDevStubs || Boolean(accounting?.isLocalDevMode));

    document.getElementById("sign-off-btn").disabled = accounting
      ? !hasSufficientBalance(accounting.userBalance, accounting.requiredFee)
      : false;
  } catch (_error) {
    // Storage may not be seeded yet on first open.
  }
}

updateUI();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.accounting || changes.ninkConfig)) {
    updateUI();
  }
});

document.getElementById("dev-stub-toggle").addEventListener("change", async (event) => {
  const useDevStubs = event.target.checked;
  const statusConsole = document.getElementById("status-console");

  try {
    if (useDevStubs) {
      await chrome.storage.local.set({
        ninkConfig: { useDevStubs: true },
        accounting: {
          userBalance: LOCAL_DEV_ACCOUNTING.balance,
          requiredFee: LOCAL_DEV_ACCOUNTING.feeRequirement,
          source: "local-dev-stubs",
          isLocalDevMode: true,
        },
      });
    } else {
      await chrome.storage.local.set({ ninkConfig: { useDevStubs: false } });
      await sendBackgroundMessage({ action: "SET_DEV_STUB_MODE", useDevStubs: false });
    }
    statusConsole.innerText = "";
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    updateUI();
  }
});

document.getElementById("sign-off-btn").addEventListener("click", async () => {
  const consoleLog = document.getElementById("status-console");
  const signOffButton = document.getElementById("sign-off-btn");
  const useDevStubs = document.getElementById("dev-stub-toggle").checked;

  consoleLog.innerText = useDevStubs
    ? "Capturing and encrypting locally (no network)..."
    : "Capturing, encrypting, and anchoring...";
  signOffButton.disabled = true;

  try {
    const { completedPackage, messageCount, isLocalDevMode, aesKeyBase64, imagesCaptured, imageCount, chatVideosCaptured, chatVideosReferenced, chatVideoCount, documentsCaptured, documentsReferenced, documentCount, imageDiscovery, scrollDiscovery, documentDiscovery, captureSchemaVersion, captureBuild, videoCaptured, videoCaptureError } =
      await runSignOffInPopup(useDevStubs);

    const { ninkFilename, keyFilename } = await triggerNinkSignOffDownloads(
      completedPackage,
      aesKeyBase64
    );

    const devLabel = isLocalDevMode ? " [Local Dev Mode]" : "";
    const discoveryHint =
      imageCount === 0 && imageDiscovery?.mainImageCount > 0
        ? " · scroll chat and retry (images visible but not captured)"
        : imageCount === 0
          ? " · no images packaged — scroll chat, reload tab, sign off again"
          : "";
    const documentHint =
      documentCount === 0 && documentDiscovery?.textMentionsFound > 0
        ? " · document filename seen in chat but not packaged — reload extension"
        : documentCount === 0 &&
            (documentDiscovery?.targetsFound > 0 ||
              documentDiscovery?.imagePreviewPromoted > 0)
          ? " · document targets found but not packaged — reload extension"
          : "";
    const reloadHint =
      captureSchemaVersion < 7 || !captureBuild
        ? " · reload extension at chrome://extensions (stale capture code)"
        : "";
    const buildLabel = captureBuild ? ` · build ${captureBuild}` : "";
    consoleLog.innerText =
      `Saved ${ninkFilename} + ${keyFilename}${devLabel}! Hash: ${(completedPackage.stateHash || "").substring(0, 10)}...` +
      (messageCount ? ` · ${messageCount} messages` : "") +
      (scrollDiscovery?.turnsVisible
        ? ` · ${scrollDiscovery.turnsVisible} turns visible`
        : "") +
      ` · ${imagesCaptured ?? 0}/${imageCount ?? 0} images captured` +
      ` · ${chatVideosCaptured ?? 0}/${chatVideoCount ?? 0} chat videos captured` +
      (chatVideosReferenced > chatVideosCaptured
        ? ` · ${chatVideosReferenced} video attachment(s) referenced`
        : "") +
      ` · ${documentsCaptured ?? 0}/${documentCount ?? 0} documents captured` +
      (documentsReferenced > documentsCaptured
        ? ` · ${documentsReferenced} document(s) referenced`
        : "") +
      (imageDiscovery ? ` · ${imageDiscovery.mainImageCount ?? 0} imgs in page` : "") +
      (videoCaptured ? " · tab video captured" : videoCaptureError ? " · tab video skipped" : "") +
      discoveryHint +
      documentHint +
      reloadHint +
      buildLabel +
      ` · payload ${completedPackage.encryptedPayload?.length ?? 0} chars (gzip)`;
  } catch (error) {
    consoleLog.innerText = `Error: ${error.message}`;
  } finally {
    signOffButton.disabled = false;
    updateUI();
  }
});
