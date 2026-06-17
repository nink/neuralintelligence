import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { resolveApiBaseUrl } from "../config/apiConfig.js";
import {
  LOCAL_DEV_ACCOUNTING,
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
import { isCloudAccounting, isDemoAccounting } from "../utils/ninkAccount.js";
import {
  applyBalanceAfterAnchor,
  writeAccountingToStorage,
} from "../utils/accountingApi.js";

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

async function verifyNinkApiHealth(apiBase) {
  const response = await fetch(`${apiBase}/health`);
  if (!response.ok) {
    throw new Error(
      `Gate 4 API not reachable at ${apiBase} (HTTP ${response.status}). Run: cd packages/api && npm run dev`
    );
  }

  const data = await response.json().catch(() => ({}));
  if (data.service !== "nink-api") {
    throw new Error(
      `Wrong server on ${apiBase}. Stop legacy dev-stub-server and run packages/api on port 8787.`
    );
  }

  return data;
}

const SESSION_STORAGE_KEYS = [
  "ninkSession",
  "accounting",
  "accountingError",
  "signOffOutcome",
  "signOffParams",
];

async function clearNinkSessionStorage() {
  await chrome.storage.local.remove(SESSION_STORAGE_KEYS);
}

async function getNinkConfig() {
  const stored = await chrome.storage.local.get("ninkConfig");
  return { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
}

let systemAccountingState = { ...LOCAL_DEV_ACCOUNTING };

async function applyAccountingState(payload, options = {}) {
  const accounting = await writeAccountingToStorage(
    {
      userBalance: String(payload.balance),
      requiredFee: String(payload.feeRequirement),
      source: payload.source || "unknown",
      isLocalDevMode: Boolean(payload.isLocalDevMode),
      updatedAt: options.updatedAt,
      lastAnchorAt: options.lastAnchorAt,
    },
    {
      fetchStartedAt: options.fetchStartedAt,
      force: options.force,
    }
  );
  systemAccountingState = accounting;
  return accounting;
}

function shouldDiscardStaleAccountingFetch(fetchStartedAt, accounting) {
  if (!accounting || isDemoAccounting(accounting)) {
    return false;
  }
  if (!accounting.updatedAt || accounting.updatedAt <= fetchStartedAt) {
    return false;
  }
  return isCloudAccounting(accounting);
}

async function reconcileStaleDemoAccounting(config, session, accounting) {
  if (config.useDevStubs || config.useWalletMode || !session?.userId) {
    return;
  }

  if (!isDemoAccounting(accounting)) {
    return;
  }

  // Replace demo data on the next successful fetch — do not clear before then.
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

fetchAccountingParameters().catch((error) => {
  console.warn("Initial accounting fetch failed:", error);
});

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

  await reconcileStaleDemoAccounting(config, session, stored.accounting);

  const apiBase = await getApiBaseUrl();
  const accountingUrl = `${apiBase}/v1/accounting/parameters?user=${encodeURIComponent(session.userId)}`;
  const fetchStartedAt = Date.now();

  try {
    if (config.useLocalApi !== false) {
      await verifyNinkApiHealth(apiBase);
    }

    const response = await fetch(accountingUrl, {
      headers: buildSessionAuthHeaders(session),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || `Accounting API returned ${response.status}`);
    }

    const data = await response.json();
    if (config.useLocalApi !== false && data.source !== "nink-cloud-api") {
      throw new Error(
        `Unexpected accounting source "${data.source}". Run packages/api on port 8787, not the legacy stub.`
      );
    }

    const latest = await chrome.storage.local.get(["ninkSession", "accounting"]);
    if (!latest.ninkSession?.userId) {
      return;
    }

    if (shouldDiscardStaleAccountingFetch(fetchStartedAt, latest.accounting)) {
      return;
    }

    await applyAccountingState(
      {
        balance: data.balance,
        feeRequirement: data.feeRequirement,
        source: data.source || "nink-cloud-api",
        isLocalDevMode: false,
      },
      { fetchStartedAt }
    );
    await chrome.storage.local.remove("accountingError");
  } catch (error) {
    console.warn("NINK accounting API unreachable.", error);
    if (config.useLocalApi === false) {
      const latest = await chrome.storage.local.get("accounting");
      if (isDemoAccounting(latest.accounting)) {
        await chrome.storage.local.remove("accounting");
      }
      await chrome.storage.local.set({
        accountingError: error.message || "Could not refresh balance from ni.nink.com.",
      });
      return;
    }
    await chrome.storage.local.remove("accounting");
    await chrome.storage.local.set({
      accountingError: error.message || "Gate 4 API unavailable.",
    });
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

  let nextBalance = payload.balance != null ? String(payload.balance) : null;
  if (!nextBalance) {
    const storedAccounting = await chrome.storage.local.get("accounting");
    const currentBalance = BigInt(storedAccounting.accounting?.userBalance || "0");
    const fee = BigInt(String(appliedFee || "0"));
    if (fee > 0n && currentBalance >= fee) {
      nextBalance = (currentBalance - fee).toString();
    }
  }

  if (nextBalance) {
    await applyBalanceAfterAnchor(nextBalance, appliedFee);
  }

  return {
    txHash: payload.txHash,
    blockNumber: payload.blockNumber ?? null,
    source: payload.source || "nink-cloud-relayer",
    isLocalDevMode: false,
    onChain: payload.onChain ?? true,
    balanceAfter: nextBalance,
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
      await clearNinkSessionStorage();
      sendResponse({ status: "SUCCESS" });
    })().catch((error) => {
      sendResponse({ status: "ERROR", message: error.message || String(error) });
    });
    return true;
  }

  if (request.action === "LOGIN_NINK_ACCOUNT") {
    (async () => {
      const email = String(request.email || "").trim().toLowerCase();
      const password = String(request.password || "");
      if (!email || !email.includes("@")) {
        sendResponse({ status: "ERROR", message: "Enter a valid email address." });
        return;
      }
      if (!password) {
        sendResponse({ status: "ERROR", message: "Enter your password." });
        return;
      }

      const config = await getNinkConfig();
      const apiBase = await getApiBaseUrl();
      if (config.useLocalApi !== false) {
        await verifyNinkApiHealth(apiBase);
      }

      const response = await fetch(`${apiBase}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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
      await applyAccountingState(
        {
          balance: payload.balance,
          feeRequirement: payload.feeRequirement,
          source: "nink-cloud-api",
          isLocalDevMode: false,
        },
        { updatedAt: Date.now() }
      );
      await chrome.storage.local.remove("accountingError");
      sendResponse({ status: "SUCCESS" });
      fetchAccountingParameters().catch((error) => {
        console.warn("Post-login accounting refresh failed:", error);
      });
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
      const useDevStubs =
        request.useDevStubs !== undefined ? Boolean(request.useDevStubs) : config.useDevStubs;
      const receipt = await anchorHashOnNetwork(
        request.stateHash,
        request.appliedFee,
        useDevStubs
      );
      sendResponse({
        status: "SUCCESS",
        receipt,
        balanceAfter: receipt.balanceAfter ?? null,
      });
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
