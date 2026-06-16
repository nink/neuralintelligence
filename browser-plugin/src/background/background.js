import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { resolveApiBaseUrl } from "../config/apiConfig.js";
import {
  LOCAL_DEV_ACCOUNTING,
  STUB_ACCOUNT_ACCOUNTING,
  createMockAnchorReceipt,
} from "../utils/devStubs.js";
import {
  anchorViaActiveTab,
  probeWalletOnTab,
  walletProbeErrorMessage,
} from "../utils/walletInject.js";
import { getOnChainWalletSnapshot } from "../utils/tokenBalance.js";
import {
  readMetaMaskAddressOnTab,
} from "../utils/walletTokenUi.js";
import { warmInjectOpenChatTabs } from "../utils/chatTab.js";

async function getApiBaseUrl() {
  const config = await getNinkConfig();
  return resolveApiBaseUrl(config);
}

function buildSessionAuthHeaders(session) {
  const headers = { "Content-Type": "application/json" };
  if (session?.sessionToken) {
    headers.Authorization = `Bearer ${session.sessionToken}`;
  }
  return headers;
}

async function getNinkConfig() {
  const stored = await chrome.storage.local.get("ninkConfig");
  return { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
}

let systemAccountingState = { ...LOCAL_DEV_ACCOUNTING };

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
  await warmInjectOpenChatTabs();
});

chrome.runtime.onStartup.addListener(() => {
  warmInjectOpenChatTabs().catch(() => {});
});

chrome.alarms.create("POLL_EXTERNAL_ACCOUNTING", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "POLL_EXTERNAL_ACCOUNTING") {
    fetchAccountingParameters();
  }
});

fetchAccountingParameters();

async function fetchAccountingParameters() {
  const stored = await chrome.storage.local.get(["ninkConfig", "ninkSession"]);
  const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };

  if (config.useDevStubs) {
    await applyAccountingState({
      ...LOCAL_DEV_ACCOUNTING,
      source: "local-dev-stubs",
    });
    return;
  }

  if (config.useWalletMode) {
    await chrome.storage.local.remove("accounting");
    return;
  }

  const session = stored.ninkSession;
  if (!session?.userId) {
    await chrome.storage.local.remove("accounting");
    return;
  }

  const apiBase = await getApiBaseUrl();
  const accountingUrl = `${apiBase}/v1/accounting/parameters?user=${encodeURIComponent(session.userId)}`;

  try {
    const response = await fetch(accountingUrl, {
      headers: buildSessionAuthHeaders(session),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || `Accounting API returned ${response.status}`);
    }

    const data = await response.json();
    await applyAccountingState({
      balance: data.balance,
      feeRequirement: data.feeRequirement,
      source: data.source || "nink-cloud-api",
      isLocalDevMode: false,
    });
  } catch (error) {
    console.warn("NINK accounting API unreachable.", error);
    if (config.useLocalApi === false) {
      await applyAccountingState(STUB_ACCOUNT_ACCOUNTING);
      return;
    }
    await chrome.storage.local.remove("accounting");
  }
}

async function anchorHashOnNetwork(stateHash, appliedFee, useDevStubs) {
  if (useDevStubs) {
    return createMockAnchorReceipt();
  }

  const stored = await chrome.storage.local.get("ninkSession");
  const session = stored.ninkSession;
  const apiBase = await getApiBaseUrl();

  const response = await fetch(`${apiBase}/v1/blockchain/anchor`, {
    method: "POST",
    headers: buildSessionAuthHeaders(session),
    body: JSON.stringify({ stateHash, tokenFeeBurned: appliedFee }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status === "ERROR") {
    throw new Error(payload.message || `Anchor API returned ${response.status}`);
  }

  if (payload.balance) {
    await applyAccountingState({
      balance: payload.balance,
      feeRequirement: appliedFee,
      source: payload.source || "nink-cloud-api",
      isLocalDevMode: false,
    });
  }

  return {
    txHash: payload.txHash,
    blockNumber: payload.blockNumber ?? null,
    source: payload.source || "nink-cloud-relayer",
    isLocalDevMode: false,
    onChain: payload.onChain ?? true,
  };
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

  if (request.action === "SET_WALLET_MODE") {
    (async () => {
      const current = await getNinkConfig();
      const nextConfig = {
        ...current,
        useWalletMode: Boolean(request.useWalletMode),
        useDevStubs: request.useWalletMode ? false : current.useDevStubs,
      };
      await chrome.storage.local.set({ ninkConfig: nextConfig });
      await fetchAccountingParameters();
      sendResponse({ status: "SUCCESS", config: nextConfig });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.toString() });
    });
    return true;
  }

  if (request.action === "REFRESH_ACCOUNTING") {
    (async () => {
      await fetchAccountingParameters();
      sendResponse({ status: "SUCCESS" });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "WARM_INJECT_CHAT_TABS") {
    (async () => {
      const injected = await warmInjectOpenChatTabs();
      sendResponse({ status: "SUCCESS", injected });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "LOGOUT_NINK_ACCOUNT") {
    (async () => {
      await chrome.storage.local.remove(["ninkSession", "accounting"]);
      sendResponse({ status: "SUCCESS" });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "LOGIN_NINK_ACCOUNT") {
    (async () => {
      const email = String(request.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        sendResponse({ status: "ERROR", message: "Enter a valid email address." });
        return;
      }

      const config = await getNinkConfig();
      if (config.useDevStubs) {
        await chrome.storage.local.set({
          ninkSession: {
            userId: email,
            email,
            displayName: email.split("@")[0] || "user",
            loggedInAt: new Date().toISOString(),
            stub: true,
          },
        });
        await fetchAccountingParameters();
        sendResponse({ status: "SUCCESS" });
        return;
      }

      const apiBase = await getApiBaseUrl();
      const response = await fetch(`${apiBase}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.status === "ERROR") {
        sendResponse({
          status: "ERROR",
          message: payload.message || `Login API returned ${response.status}`,
        });
        return;
      }

      await chrome.storage.local.set({
        ninkSession: {
          userId: payload.user.userId,
          email: payload.user.email,
          displayName: payload.user.displayName,
          sessionToken: payload.sessionToken,
          sessionExpiresAt: payload.expiresAt,
          loggedInAt: new Date().toISOString(),
          stub: false,
        },
      });
      await fetchAccountingParameters();
      sendResponse({ status: "SUCCESS" });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "PROBE_WALLET_ON_TAB") {
    (async () => {
      const probe = await probeWalletOnTab(request.tabId);
      sendResponse({ status: "SUCCESS", probe });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "ANCHOR_SESSION_TO_LEDGER") {
    (async () => {
      const { anchorViaLocalRpc, ensureLocalChainReady, isLocalHardhatChain } =
        await import("../utils/localChainAnchor.js");
      let walletResult;

      if (isLocalHardhatChain()) {
        await ensureLocalChainReady();
        walletResult = await anchorViaLocalRpc(request.injectionArgs);
      } else {
        walletResult = await anchorViaActiveTab(
          request.tabId,
          request.injectionArgs
        );
      }

      sendResponse({ status: "SUCCESS", result: walletResult });
    })().catch((error) => {
      sendResponse({
        status: "ERROR",
        message: error.message || String(error),
      });
    });
    return true;
  }

  if (request.action === "ENSURE_LOCAL_CHAIN") {
    (async () => {
      const { ensureLocalChainReady } = await import("../utils/localChainAnchor.js");
      const status = await ensureLocalChainReady();
      sendResponse({ status: "SUCCESS", chain: status });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "GET_METAMASK_ADDRESS") {
    (async () => {
      const address = await readMetaMaskAddressOnTab(request.tabId);
      sendResponse({ status: "SUCCESS", address });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "GET_ON_CHAIN_WALLET") {
    (async () => {
      let walletAddress = request.walletAddress || null;

      if (request.tabId) {
        try {
          walletAddress = (await readMetaMaskAddressOnTab(request.tabId)) || walletAddress;
        } catch (_error) {
          // Fall back to local dev wallet or explicit address.
        }
      }

      const snapshot = await getOnChainWalletSnapshot(walletAddress);
      sendResponse({ status: "SUCCESS", snapshot });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
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
