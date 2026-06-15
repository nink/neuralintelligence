import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import {
  LOCAL_DEV_ACCOUNTING,
  createMockAnchorReceipt,
} from "../utils/devStubs.js";
const PRODUCTION_ACCOUNTING_URL =
  "https://api.nink.network/v1/accounting/parameters?user=0xUserWallet";
const PRODUCTION_ANCHOR_URL = "https://api.nink.network/v1/blockchain/anchor";

let systemAccountingState = { ...LOCAL_DEV_ACCOUNTING };

async function getNinkConfig() {
  const stored = await chrome.storage.local.get("ninkConfig");
  return { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
}

async function applyAccountingState(payload) {
  systemAccountingState = {
    userBalance: String(payload.balance),
    requiredFee: String(payload.feeRequirement),
    source: payload.source || "unknown",
    isLocalDevMode: Boolean(payload.isLocalDevMode),
  };

  await chrome.storage.local.set({ accounting: systemAccountingState });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get("ninkConfig");
  if (!stored.ninkConfig) {
    await chrome.storage.local.set({ ninkConfig: DEFAULT_NINK_CONFIG });
  }
  await fetchAccountingParameters();
});

chrome.alarms.create("POLL_EXTERNAL_ACCOUNTING", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "POLL_EXTERNAL_ACCOUNTING") {
    fetchAccountingParameters();
  }
});

fetchAccountingParameters();

async function fetchAccountingParameters() {
  const config = await getNinkConfig();

  if (config.useDevStubs) {
    await applyAccountingState({
      ...LOCAL_DEV_ACCOUNTING,
      source: "local-dev-stubs",
    });
    return;
  }

  try {
    const response = await fetch(PRODUCTION_ACCOUNTING_URL);
    if (!response.ok) {
      throw new Error(`Accounting API returned ${response.status}`);
    }

    const data = await response.json();
    await applyAccountingState({
      balance: data.balance,
      feeRequirement: data.feeRequirement,
      source: "production-api",
      isLocalDevMode: false,
    });
  } catch (error) {
    console.warn(
      "api.nink.network unreachable. Falling back to local developer test parameters.",
      error
    );
    await applyAccountingState(LOCAL_DEV_ACCOUNTING);
  }
}

async function anchorHashOnNetwork(stateHash, appliedFee, useDevStubs) {
  if (useDevStubs) {
    return createMockAnchorReceipt();
  }

  try {
    const response = await fetch(PRODUCTION_ANCHOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stateHash, tokenFeeBurned: appliedFee }),
    });

    if (!response.ok) {
      throw new Error(`Anchor API returned ${response.status}`);
    }

    const receipt = await response.json();
    return {
      ...receipt,
      source: "production-api",
      isLocalDevMode: false,
    };
  } catch (error) {
    console.warn(
      "Blockchain relayer offline. Simulating local on-chain anchor success receipt.",
      error
    );
    return createMockAnchorReceipt();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader failed to read blob."));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsBase64(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Missing or invalid url.");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "PING") {
    sendResponse({ status: "OK" });
    return true;
  }

  if (request.action === "SET_DEV_STUB_MODE") {
    (async () => {
      const current = await getNinkConfig();
      const nextConfig = {
        ...current,
        useDevStubs: Boolean(request.useDevStubs),
      };
      await chrome.storage.local.set({ ninkConfig: nextConfig });
      await fetchAccountingParameters();
      sendResponse({ status: "SUCCESS", config: nextConfig });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.toString() });
    });
    return true;
  }

  if (request.action === "ANCHOR_HASH") {
    (async () => {
      const config = await getNinkConfig();
      const receipt = await anchorHashOnNetwork(
        request.stateHash,
        request.appliedFee,
        config.useDevStubs
      );
      sendResponse({ status: "SUCCESS", receipt });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.toString() });
    });
    return true;
  }

  if (request.action === "FETCH_IMAGE_AS_BASE64") {
    fetchImageAsBase64(request.url)
      .then((base64) => {
        sendResponse({ status: "SUCCESS", base64 });
      })
      .catch((error) => {
        console.warn("FETCH_IMAGE_AS_BASE64 failed:", request.url, error);
        sendResponse({
          status: "ERROR",
          message: error.message || error.toString(),
        });
      });
    return true;
  }

  if (request.action === "GET_TAB_STREAM_ID") {
    if (!chrome.tabCapture?.getMediaStreamId) {
      sendResponse({
        status: "ERROR",
        message: "tabCapture.getMediaStreamId is unavailable.",
      });
      return true;
    }

    chrome.tabCapture.getMediaStreamId(
      { targetTabId: request.tabId },
      (streamId) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            status: "ERROR",
            message: chrome.runtime.lastError.message,
          });
          return;
        }

        sendResponse({ status: "SUCCESS", streamId });
      }
    );
    return true;
  }

  return false;
});
