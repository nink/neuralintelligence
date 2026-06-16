import { hasSufficientBalance, formatTokenForDisplay } from "../utils/tokenMath.js";
import { LOCAL_DEV_ACCOUNTING } from "../utils/devStubs.js";
import { isSupportedChatUrl } from "../config/chatPlatforms.js";
import { NINK_CHAIN_CONFIG } from "../config/chainConfig.js";
import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { getOnChainWalletSnapshot, readChainHealth } from "../utils/tokenBalance.js";
import {
  requestWalletConnectOnTab,
  walletConnectErrorMessage,
} from "../utils/walletTokenUi.js";
import { validateSignOffReady } from "../signoff/runSignOffPipeline.js";

function isLocalHardhatChain() {
  return Number(NINK_CHAIN_CONFIG.chainId) === 31337;
}

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
  const useDevStubs = stored.ninkConfig?.useDevStubs ?? DEFAULT_NINK_CONFIG.useDevStubs;
  const connectedAddress = stored.connectedWallet?.address || null;

  if (useDevStubs) {
    onchainPanel.hidden = true;
    mockPanel.hidden = false;
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
    const stored = await readLocalStorage(["accounting", "ninkConfig"]);
    const accounting = stored.accounting;
    const useDevStubs = stored.ninkConfig?.useDevStubs ?? DEFAULT_NINK_CONFIG.useDevStubs;

    document.getElementById("dev-stub-toggle").checked = useDevStubs;

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
        : false;
    } else {
      await refreshOnChainWalletPanel();
    }

    setLocalDevModeIndicator(useDevStubs);
  } catch (error) {
    const healthLabel = document.getElementById("chain-health-label");
    if (healthLabel) {
      healthLabel.textContent = error.message || "UI update failed";
      healthLabel.className = "onchain-note chain-health-bad";
    }
  }
}

updateUI();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.accounting || changes.ninkConfig || changes.connectedWallet)
  ) {
    updateUI();
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

document.getElementById("wallet-setup-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("wallet-setup.html") });
});

let signOffInProgress = false;

document.getElementById("sign-off-btn").addEventListener("click", async () => {
  if (signOffInProgress) {
    return;
  }

  const consoleLog = document.getElementById("status-console");
  const signOffButton = document.getElementById("sign-off-btn");
  const useDevStubs = document.getElementById("dev-stub-toggle").checked;

  signOffInProgress = true;
  signOffButton.disabled = true;

  try {
    const tab = await getActiveChatTab();
    await validateSignOffReady(useDevStubs, tab.id);

    await chrome.storage.local.set({
      signOffParams: {
        useDevStubs,
        chatTabId: tab.id,
        startedAt: new Date().toISOString(),
      },
    });

    await chrome.windows.create({
      url: chrome.runtime.getURL("signoff-runner.html"),
      type: "popup",
      width: 440,
      height: 560,
      focused: true,
    });

    consoleLog.innerText =
      "Sign-off window opened — keep it open, confirm MetaMask on your chat tab, then choose where to save both files.";
  } catch (error) {
    consoleLog.innerText = `Error: ${error.message}`;
  } finally {
    signOffInProgress = false;
    signOffButton.disabled = false;
    updateUI();
  }
});
