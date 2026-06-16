import { hasSufficientBalance, formatTokenForDisplay } from "../utils/tokenMath.js";
import { LOCAL_DEV_ACCOUNTING, STUB_ACCOUNT_ACCOUNTING } from "../utils/devStubs.js";
import { isSupportedChatUrl } from "../config/chatPlatforms.js";
import { resolveChatTabForSignOff, ensureScraperReadyOnTab } from "../utils/chatTab.js";
import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { getOnChainWalletSnapshot, readChainHealth } from "../utils/tokenBalance.js";
import {
  requestWalletConnectOnTab,
  walletConnectErrorMessage,
} from "../utils/walletTokenUi.js";
import { validateSignOffReady } from "../signoff/runSignOffPipeline.js";
import {
  formatAccountLabel,
  isValidStubEmail,
} from "../utils/ninkAccount.js";

function getConfigFlags(ninkConfig = {}) {
  return {
    useDevStubs: ninkConfig.useDevStubs ?? DEFAULT_NINK_CONFIG.useDevStubs,
    useWalletMode: ninkConfig.useWalletMode ?? DEFAULT_NINK_CONFIG.useWalletMode,
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

  const stored = await readLocalStorage(["accounting", "ninkSession"]);
  const session = stored.ninkSession;
  const accounting = stored.accounting;

  if (!session?.userId) {
    loggedOut.hidden = false;
    loggedIn.hidden = true;
    signOffButton.disabled = true;
    return;
  }

  loggedOut.hidden = true;
  loggedIn.hidden = false;
  sessionLabel.textContent = formatAccountLabel(session);

  if (!accounting) {
    balanceEl.textContent = "Loading…";
    feeEl.textContent = "—";
    sourceLabel.textContent = "Fetching balance from NINK…";
    signOffButton.disabled = true;
    return;
  }

  balanceEl.textContent = `${formatTokenForDisplay(accounting.userBalance)} NINK`;
  feeEl.textContent = formatTokenForDisplay(accounting.requiredFee);
  sourceLabel.textContent =
    accounting.source === "production-api" || accounting.source === "nink-cloud-api"
      ? "Balance from your NINK account."
      : "Demo balance (start packages/api for live balance).";

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
    const { useDevStubs, useWalletMode } = getConfigFlags(stored.ninkConfig || {});

    document.getElementById("dev-stub-toggle").checked = useDevStubs;
    document.getElementById("wallet-mode-toggle").checked = useWalletMode;

    document.getElementById("account-panel").hidden = useDevStubs || useWalletMode;
    document.getElementById("onchain-panel").hidden = !useWalletMode || useDevStubs;
    document.getElementById("mock-metrics-panel").hidden = !useDevStubs;

    if (useDevStubs) {
      if (accounting) {
        document.getElementById("balance-display").innerText = formatTokenForDisplay(
          accounting.userBalance
        );
        document.getElementById("fee-display").innerText = formatTokenForDisplay(
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

  if (!isValidStubEmail(email)) {
    statusConsole.innerText = "Error: Enter a valid email address.";
    return;
  }

  try {
    loginBtn.disabled = true;
    statusConsole.innerText = "Signing in…";

    const response = await sendBackgroundMessage({
      action: "LOGIN_NINK_ACCOUNT",
      email,
    });

    if (response?.status !== "SUCCESS") {
      throw new Error(response?.message || "Sign-in failed.");
    }

    const stored = await readLocalStorage(["ninkSession"]);
    statusConsole.innerText = `Signed in as ${stored.ninkSession?.email || email}`;
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
  try {
    await sendBackgroundMessage({ action: "LOGOUT_NINK_ACCOUNT" });
    statusConsole.innerText = "Signed out.";
  } catch (error) {
    statusConsole.innerText = `Error: ${error.message}`;
  }
  updateUI();
}

document.getElementById("login-stub-btn").addEventListener("click", loginStubFromPopup);
document.getElementById("logout-stub-btn").addEventListener("click", logoutStubFromPopup);
document.getElementById("login-email-input").addEventListener("keydown", (event) => {
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
