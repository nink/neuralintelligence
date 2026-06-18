import { hasSufficientBalance, formatCreditsForDisplay } from "../utils/tokenMath.js";
import { LOCAL_DEV_ACCOUNTING } from "../utils/devStubs.js";
import { isSupportedChatUrl } from "../config/chatPlatforms.js";
import { resolveChatTabForSignOff, ensureScraperReadyOnTab } from "../utils/chatTab.js";
import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { resolveApiBaseUrl, NINK_API_CONFIG } from "../config/apiConfig.js";
import { getOnChainWalletSnapshot, readChainHealth } from "../utils/tokenBalance.js";
import {
  requestWalletConnectOnTab,
  walletConnectErrorMessage,
} from "../utils/walletTokenUi.js";
import { validateSignOffReady } from "../signoff/runSignOffPipeline.js";
import {
  formatAccountLabel,
  isCloudAccounting,
  isDemoAccounting,
  isValidStubEmail,
  normalizeAccountEmail,
  readLastLoginEmail,
  saveLastLoginEmail,
} from "../utils/ninkAccount.js";
import {
  fetchCloudAccountingParameters,
  writeAccountingToStorage,
} from "../utils/accountingApi.js";

let popupAccountingRefresh = null;

async function ensureAccountingFresh(config, session) {
  if (config.useDevStubs || config.useWalletMode || !session?.sessionToken) {
    return null;
  }

  if (popupAccountingRefresh) {
    return popupAccountingRefresh;
  }

  popupAccountingRefresh = (async () => {
    const fetchStartedAt = Date.now();
    const accounting = await fetchCloudAccountingParameters(config, session);
    return writeAccountingToStorage(
      { ...accounting, updatedAt: Date.now() },
      { fetchStartedAt }
    );
  })()
    .catch(async (error) => {
      await chrome.storage.local.set({
        accountingError: error.message || "Could not refresh balance.",
      });
      throw error;
    })
    .finally(() => {
      popupAccountingRefresh = null;
    });

  return popupAccountingRefresh;
}

async function verifyNinkApiHealth(apiBase) {
  const response = await fetch(`${apiBase}/health`);
  if (!response.ok) {
    throw new Error(
      `Gate 4 API not reachable at ${apiBase}. Run: cd packages/api && npm run dev`
    );
  }

  const data = await response.json().catch(() => ({}));
  if (data.service !== "nink-api") {
    throw new Error(
      `Wrong server on ${apiBase}. Stop the legacy stub and run packages/api on port 8787.`
    );
  }
}

async function loginAccountFromPopup(email, password) {
  const stored = await readLocalStorage(["ninkConfig"]);
  const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
  const normalizedEmail = normalizeAccountEmail(email);

  if (!password) {
    throw new Error("Enter your password.");
  }

  const apiBase = resolveApiBaseUrl(config);
  if (config.useLocalApi !== false) {
    await verifyNinkApiHealth(apiBase);
  }

  const response = await fetch(`${apiBase}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizedEmail, password }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status === "ERROR") {
    throw new Error(payload.message || `Login API returned ${response.status}`);
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
    accounting: {
      userBalance: String(payload.balance),
      requiredFee: String(payload.feeRequirement),
      source: "nink-cloud-api",
      isLocalDevMode: false,
      updatedAt: Date.now(),
    },
  });
  await chrome.storage.local.remove("accountingError");
  await saveLastLoginEmail(normalizedEmail);

  return payload.user.email || normalizedEmail;
}

function getConfigFlags(ninkConfig = {}) {
  return {
    useDevStubs: ninkConfig.useDevStubs ?? DEFAULT_NINK_CONFIG.useDevStubs,
    useWalletMode: ninkConfig.useWalletMode ?? DEFAULT_NINK_CONFIG.useWalletMode,
    useLocalApi: ninkConfig.useLocalApi ?? DEFAULT_NINK_CONFIG.useLocalApi,
  };
}

function setLocalDevModeIndicator(useDevStubs, useWalletMode) {
  const badge = document.getElementById("dev-mode-badge");
  if (useDevStubs) {
    badge.hidden = false;
    badge.textContent = "[Mock Mode]";
    return;
  }
  if (useWalletMode) {
    badge.hidden = false;
    badge.textContent = "[Wallet Mode]";
    return;
  }
  badge.hidden = true;
}

async function refreshAccountPanel() {
  const accountPanel = document.getElementById("account-panel");
  const loggedOut = document.getElementById("account-logged-out");
  const loggedIn = document.getElementById("account-logged-in");
  const balanceEl = document.getElementById("account-balance-display");
  const feeEl = document.getElementById("account-fee-display");
  const sessionLabel = document.getElementById("account-session-label");
  const sourceLabel = document.getElementById("account-source-label");
  const signOffButton = document.getElementById("sign-off-btn");

  accountPanel.hidden = false;

  const stored = await readLocalStorage(["accounting", "ninkSession", "accountingError", "ninkConfig"]);
  const session = stored.ninkSession;
  const accounting = stored.accounting;
  const accountingError = stored.accountingError;
  const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
  const apiBase = resolveApiBaseUrl(config);

  if (!session?.userId) {
    loggedOut.hidden = false;
    loggedIn.hidden = true;
    signOffButton.disabled = true;
    const lastEmail = await readLastLoginEmail();
    const emailInput = document.getElementById("login-email-input");
    if (emailInput && lastEmail) {
      emailInput.value = lastEmail;
    }
    return;
  }

  loggedOut.hidden = true;
  loggedIn.hidden = false;
  sessionLabel.textContent = formatAccountLabel(session);

  if (!session.sessionToken && !config.useDevStubs) {
    balanceEl.textContent = "—";
    feeEl.textContent = "—";
    sourceLabel.textContent =
      "Session expired — sign out, then sign in again (Mock mode must be off).";
    signOffButton.disabled = true;
    return;
  }

  const needsCloudRefresh =
    !config.useDevStubs &&
    !config.useWalletMode &&
    session.sessionToken &&
    (!accounting || isDemoAccounting(accounting));

  if (needsCloudRefresh) {
    ensureAccountingFresh(config, session).catch(() => {});
  }

  if (!accounting || (isDemoAccounting(accounting) && !config.useDevStubs)) {
    balanceEl.textContent = "—";
    feeEl.textContent = "—";
    sourceLabel.textContent =
      accountingError || `Fetching balance from ${apiBase}…`;
    signOffButton.disabled = true;
    return;
  }

  balanceEl.textContent = formatCreditsForDisplay(accounting.userBalance);
  feeEl.textContent = formatCreditsForDisplay(accounting.requiredFee);
  sourceLabel.textContent = isCloudAccounting(accounting)
    ? `Balance from your NINK account (${apiBase}).`
    : accountingError || "Could not verify balance — try signing out and in again.";

  signOffButton.disabled = !hasSufficientBalance(
    accounting.userBalance,
    accounting.requiredFee
  );
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
        const messageText = chrome.runtime.lastError.message || "Background message failed.";
        if (/message port closed/i.test(messageText)) {
          reject(
            new Error(
              "Extension background stopped responding. Reload the extension at chrome://extensions, then try again."
            )
          );
          return;
        }
        reject(new Error(messageText));
        return;
      }
      if (response === undefined) {
        reject(new Error("Extension did not respond. Reload the extension and try again."));
        return;
      }
      resolve(response);
    });
  });
}

function getActiveChatTab() {
  return resolveChatTabForSignOff();
}

function isSupportedChatTab(tab) {
  return isSupportedChatUrl(String(tab.url || ""));
}
async function refreshOnChainWalletPanel() {
  const onchainPanel = document.getElementById("onchain-panel");
  const mockPanel = document.getElementById("mock-metrics-panel");
  const balanceEl = document.getElementById("onchain-balance-display");
  const feeEl = document.getElementById("onchain-fee-display");
  const walletLabel = document.getElementById("onchain-wallet-label");
  const healthLabel = document.getElementById("chain-health-label");
  const connectBtn = document.getElementById("connect-wallet-btn");
  const disconnectBtn = document.getElementById("disconnect-wallet-btn");

  const stored = await readLocalStorage(["ninkConfig", "connectedWallet"]);
  const { useDevStubs, useWalletMode } = getConfigFlags(stored.ninkConfig || {});
  const connectedAddress = stored.connectedWallet?.address || null;

  if (useDevStubs || !useWalletMode) {
    onchainPanel.hidden = true;
    return;
  }

  onchainPanel.hidden = false;
  mockPanel.hidden = true;
  connectBtn.hidden = Boolean(connectedAddress);
  disconnectBtn.hidden = !connectedAddress;
  healthLabel.textContent = "";

  if (!connectedAddress) {
    balanceEl.textContent = "—";
    feeEl.textContent = "—";
    walletLabel.textContent =
      "Connect MetaMask on your chat tab to view balance and sign off.";
    document.getElementById("sign-off-btn").disabled = true;

    try {
      const feeOnly = await readChainHealth();
      if (feeOnly.ok) {
        const snapshot = await getOnChainWalletSnapshot(null);
        if (snapshot?.ok) {
          feeEl.textContent = snapshot.anchorFeeFormatted;
          healthLabel.textContent = `Chain ${snapshot.health.chainId} OK · connect wallet to continue`;
          healthLabel.className = "onchain-note chain-health-ok";
        }
      }
    } catch (_error) {
      healthLabel.textContent = "Start Hardhat node to use on-chain sign-off.";
      healthLabel.className = "onchain-note chain-health-bad";
    }
    return;
  }

  walletLabel.textContent = "Reading balance from token contract…";

  try {
    const snapshot = await getOnChainWalletSnapshot(connectedAddress);

    if (!snapshot?.ok) {
      balanceEl.textContent = "Unavailable";
      feeEl.textContent = "—";
      walletLabel.textContent =
        "Start Hardhat node, then redeploy: npx hardhat run scripts/deploy.js --network localhost";
      healthLabel.textContent = snapshot?.health?.reason || "Chain unavailable";
      healthLabel.className = "onchain-note chain-health-bad";
      document.getElementById("sign-off-btn").disabled = true;
      return;
    }

    balanceEl.textContent = `${snapshot.balanceFormatted} NINK`;
    feeEl.textContent = snapshot.anchorFeeFormatted;
    walletLabel.textContent = `Connected ${shortAddress(snapshot.walletAddress)} · balance read from token contract (not MetaMask UI).`;
    healthLabel.textContent = `Chain ${snapshot.health.chainId} OK · token ${shortAddress(snapshot.tokenAddress)}`;
    healthLabel.className = "onchain-note chain-health-ok";

    document.getElementById("sign-off-btn").disabled = !hasSufficientBalance(
      snapshot.balanceWei,
      snapshot.anchorFeeWei
    );
  } catch (error) {
    balanceEl.textContent = "Unavailable";
    feeEl.textContent = "—";
    walletLabel.textContent = error.message || "Could not read on-chain balance.";
    healthLabel.textContent = "Is Hardhat running on http://127.0.0.1:8545 ?";
    healthLabel.className = "onchain-note chain-health-bad";
    document.getElementById("sign-off-btn").disabled = true;
  }
}

function shortAddress(address) {
  const value = String(address || "");
  if (value.length < 10) {
    return value || "unknown";
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

async function updateUI() {
  try {
    const stored = await readLocalStorage(["accounting", "ninkConfig", "ninkSession"]);
    const accounting = stored.accounting;
    const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
    const { useDevStubs, useWalletMode, useLocalApi } = getConfigFlags(stored.ninkConfig || {});

    document.getElementById("dev-stub-toggle").checked = useDevStubs;
    document.getElementById("wallet-mode-toggle").checked = useWalletMode;
    document.getElementById("local-api-toggle").checked = useLocalApi;

    const apiEndpointLabel = document.getElementById("api-endpoint-label");
    if (apiEndpointLabel) {
      apiEndpointLabel.textContent = useLocalApi
        ? `API: ${NINK_API_CONFIG.localDevBaseUrl}`
        : `API: ${NINK_API_CONFIG.productionBaseUrl}`;
    }

    document.getElementById("account-panel").hidden = useDevStubs || useWalletMode;
    document.getElementById("onchain-panel").hidden = !useWalletMode || useDevStubs;
    document.getElementById("mock-metrics-panel").hidden = !useDevStubs;

    if (useDevStubs) {
      if (accounting) {
        document.getElementById("balance-display").innerText = formatCreditsForDisplay(
          accounting.userBalance
        );
        document.getElementById("fee-display").innerText = formatCreditsForDisplay(
          accounting.requiredFee
        );
      }

      document.getElementById("sign-off-btn").disabled = accounting
        ? !hasSufficientBalance(accounting.userBalance, accounting.requiredFee)
        : true;
    } else if (useWalletMode) {
      await refreshOnChainWalletPanel();
    } else {
      await refreshAccountPanel();
    }

    setLocalDevModeIndicator(useDevStubs, useWalletMode);

    if (signOffInProgress) {
      document.getElementById("sign-off-btn").disabled = true;
    }
  } catch (error) {
    const statusConsole = document.getElementById("status-console");
    if (statusConsole && !statusConsole.textContent) {
      statusConsole.innerText = error.message || "UI update failed";
    }
  }
}

updateUI();
refreshSignOffStatusFromStorage();
readLocalStorage(["ninkSession", "ninkConfig"]).then((stored) => {
  const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
  if (stored.ninkSession?.userId && !config.useDevStubs && !config.useWalletMode) {
    ensureAccountingFresh(config, stored.ninkSession).catch(() => {});
  }
});
sendBackgroundMessage({ action: "WARM_INJECT_CHAT_TABS" }).catch(() => {});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.signOffOutcome?.newValue) {
    applySignOffOutcome(changes.signOffOutcome.newValue);
  }

  if (changes.signOffParams?.newValue && !changes.signOffOutcome) {
    signOffInProgress = true;
    const consoleLog = document.getElementById("status-console");
    consoleLog.innerText =
      "Sign-off in progress… save both files when the runner window prompts.";
    updateUI();
  }

  if (
    changes.accounting ||
    changes.accountingError ||
    changes.ninkConfig ||
    changes.connectedWallet ||
    changes.ninkSession
  ) {
    updateUI();
  }
});

async function loginStubFromPopup() {
  const statusConsole = document.getElementById("status-console");
  const loginBtn = document.getElementById("login-stub-btn");
  const email = document.getElementById("login-email-input").value;
  const password = document.getElementById("login-password-input").value;

  if (!isValidStubEmail(email)) {
    statusConsole.innerText = "Error: Enter a valid email address.";
    return;
  }

  if (!password) {
    statusConsole.innerText = "Error: Enter your password.";
    return;
  }

  try {
    loginBtn.disabled = true;
    statusConsole.innerText = "Signing in…";

    const signedInEmail = await loginAccountFromPopup(email, password);
    statusConsole.innerText = `Signed in as ${signedInEmail}`;
    document.getElementById("login-password-input").value = "";
    await updateUI();
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    loginBtn.disabled = false;
    updateUI();
  }
}

async function logoutStubFromPopup() {
  const statusConsole = document.getElementById("status-console");
  const logoutBtn = document.getElementById("logout-stub-btn");
  const emailInput = document.getElementById("login-email-input");
  const passwordInput = document.getElementById("login-password-input");

  try {
    logoutBtn.disabled = true;
    statusConsole.innerText = "Signing out…";
    signOffInProgress = false;

    const sessionStored = await readLocalStorage(["ninkSession"]);
    const emailToKeep =
      normalizeAccountEmail(emailInput?.value) || sessionStored.ninkSession?.email || "";
    if (emailToKeep) {
      await saveLastLoginEmail(emailToKeep);
    }

    await chrome.storage.local.remove([
      "ninkSession",
      "accounting",
      "accountingError",
      "signOffOutcome",
      "signOffParams",
    ]);

    try {
      await sendBackgroundMessage({ action: "LOGOUT_NINK_ACCOUNT" });
    } catch (_error) {
      // Local storage already cleared above.
    }

    if (emailInput && emailToKeep) {
      emailInput.value = emailToKeep;
    }
    if (passwordInput) {
      passwordInput.value = "";
    }

    statusConsole.innerText = "Signed out.";
    await updateUI();
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    logoutBtn.disabled = false;
  }
}

document.getElementById("login-stub-btn").addEventListener("click", loginStubFromPopup);
document.getElementById("logout-stub-btn").addEventListener("click", logoutStubFromPopup);
document.getElementById("login-email-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loginStubFromPopup();
  }
});
document.getElementById("login-password-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loginStubFromPopup();
  }
});

async function connectWalletFromPopup() {
  const statusConsole = document.getElementById("status-console");
  const connectBtn = document.getElementById("connect-wallet-btn");

  try {
    const tab = await getActiveChatTab();
    if (!isSupportedChatTab(tab)) {
      throw new Error(
        "Open a supported AI chat tab (ChatGPT, Gemini, Claude, etc.), then click Connect wallet."
      );
    }

    connectBtn.disabled = true;
    statusConsole.innerText =
      "Keep this popup open. Confirm connection in MetaMask on the chat tab…";

    const result = await requestWalletConnectOnTab(tab.id);
    if (!result?.ok || !result.address) {
      throw new Error(walletConnectErrorMessage(result) || "Wallet connection failed.");
    }

    await chrome.storage.local.set({
      connectedWallet: {
        address: result.address,
        connectedAt: new Date().toISOString(),
      },
    });

    statusConsole.innerText = `Connected ${shortAddress(result.address)}`;
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    connectBtn.disabled = false;
    updateUI();
  }
}

async function disconnectWalletFromPopup() {
  const statusConsole = document.getElementById("status-console");
  await chrome.storage.local.remove("connectedWallet");
  statusConsole.innerText = "Wallet disconnected.";
  updateUI();
}

document.getElementById("connect-wallet-btn").addEventListener("click", connectWalletFromPopup);
document.getElementById("disconnect-wallet-btn").addEventListener("click", disconnectWalletFromPopup);

document.getElementById("dev-stub-toggle").addEventListener("change", async (event) => {
  const useDevStubs = event.target.checked;
  const statusConsole = document.getElementById("status-console");

  try {
    const stored = await readLocalStorage(["ninkConfig"]);
    const current = stored.ninkConfig || {};

    if (useDevStubs) {
      await chrome.storage.local.set({
        ninkConfig: {
          ...DEFAULT_NINK_CONFIG,
          ...current,
          useDevStubs: true,
          useWalletMode: false,
        },
        accounting: {
          userBalance: LOCAL_DEV_ACCOUNTING.balance,
          requiredFee: LOCAL_DEV_ACCOUNTING.feeRequirement,
          source: "local-dev-stubs",
          isLocalDevMode: true,
        },
      });
    } else {
      await chrome.storage.local.set({
        ninkConfig: {
          ...DEFAULT_NINK_CONFIG,
          ...current,
          useDevStubs: false,
        },
      });
      await sendBackgroundMessage({ action: "SET_DEV_STUB_MODE", useDevStubs: false });
    }
    statusConsole.innerText = "";
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    updateUI();
  }
});

document.getElementById("wallet-mode-toggle").addEventListener("change", async (event) => {
  const useWalletMode = event.target.checked;
  const statusConsole = document.getElementById("status-console");

  try {
    const response = await sendBackgroundMessage({
      action: "SET_WALLET_MODE",
      useWalletMode,
    });

    if (response?.status !== "SUCCESS") {
      throw new Error(response?.message || "Could not switch wallet mode.");
    }

    statusConsole.innerText = useWalletMode
      ? "Wallet mode enabled — connect MetaMask below Advanced options."
      : "Wallet mode off — sign in with your NINK account.";
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    updateUI();
  }
});

document.getElementById("local-api-toggle").addEventListener("change", async (event) => {
  const useLocalApi = event.target.checked;
  const statusConsole = document.getElementById("status-console");

  try {
    const stored = await readLocalStorage(["ninkConfig"]);
    const current = stored.ninkConfig || {};
    await chrome.storage.local.set({
      ninkConfig: {
        ...DEFAULT_NINK_CONFIG,
        ...current,
        useLocalApi,
      },
    });
    await sendBackgroundMessage({ action: "REFRESH_ACCOUNTING" }).catch(() => {});
    statusConsole.innerText = useLocalApi
      ? "Using local dev API (127.0.0.1:8787). Sign out and sign in again."
      : "Using production API (ni.nink.com). Sign out and sign in again.";
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  } finally {
    updateUI();
  }
});

document.getElementById("open-viewer-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

let signOffInProgress = false;

function applySignOffOutcome(outcome) {
  const consoleLog = document.getElementById("status-console");
  signOffInProgress = false;

  if (outcome?.status === "success") {
    consoleLog.innerText =
      outcome.message ||
      "Files downloaded. Open Session Viewer below to view and verify your session.";
  } else if (outcome?.status === "error") {
    consoleLog.innerText = `Error: ${outcome.message || "Sign-off failed."}`;
  }

  updateUI();
}

async function refreshSignOffStatusFromStorage() {
  const stored = await readLocalStorage(["signOffParams", "signOffOutcome"]);

  if (stored.signOffOutcome) {
    applySignOffOutcome(stored.signOffOutcome);
    return;
  }

  if (stored.signOffParams) {
    signOffInProgress = true;
    document.getElementById("status-console").innerText =
      "Sign-off in progress… save both files when the runner window prompts.";
    updateUI();
  }
}

document.getElementById("sign-off-btn").addEventListener("click", async () => {
  if (signOffInProgress) {
    return;
  }

  const consoleLog = document.getElementById("status-console");
  const signOffButton = document.getElementById("sign-off-btn");
  const useDevStubs = document.getElementById("dev-stub-toggle").checked;
  const useWalletMode = document.getElementById("wallet-mode-toggle").checked;

  signOffInProgress = true;
  signOffButton.disabled = true;

  try {
    const tab = await resolveChatTabForSignOff();
    const scraperReady = await ensureScraperReadyOnTab(tab.id);
    if (!scraperReady.ok) {
      throw new Error(scraperReady.message || "Capture is not ready on this tab yet.");
    }
    await validateSignOffReady(useDevStubs, tab.id);

    await chrome.storage.local.remove("signOffOutcome");
    await chrome.storage.local.set({
      signOffParams: {
        useDevStubs,
        useWalletMode,
        chatTabId: tab.id,
        startedAt: new Date().toISOString(),
      },
    });

    consoleLog.innerText =
      "Sign-off in progress… save both files when the runner window prompts.";

    await chrome.windows.create({
      url: chrome.runtime.getURL("signoff-runner.html"),
      type: "popup",
      width: 440,
      height: 560,
      focused: true,
    });
  } catch (error) {
    consoleLog.innerText = `Error: ${error.message}`;
    signOffInProgress = false;
  } finally {
    if (!signOffInProgress) {
      signOffButton.disabled = false;
    }
    updateUI();
  }
});
