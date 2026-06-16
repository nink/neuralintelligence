const WALLET_ANCHOR_SCRIPT = "src/inpage/walletAnchor.js";

export async function probeWalletOnTab(tabId) {
  if (!tabId) {
    return { ok: false, reason: "no-tab" };
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const eth = window.ethereum;
      if (!eth) {
        return { ok: false, reason: "no-wallet" };
      }
      const providers = Array.isArray(eth.providers) ? eth.providers : [eth];
      const hasMetaMask = providers.some((provider) => provider.isMetaMask);
      return {
        ok: true,
        hasMetaMask,
        providerCount: providers.length,
      };
    },
  });

  return result || { ok: false, reason: "probe-failed" };
}

async function ensureWalletBridgeLoaded(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [WALLET_ANCHOR_SCRIPT],
  });
}

async function readAnchorResultFromDom(tabId) {
  const fallback = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => document.documentElement.getAttribute("data-nink-anchor-result"),
  });
  return fallback?.[0]?.result || null;
}

export async function anchorViaActiveTab(tabId, injectionArgs) {
  if (!tabId) {
    throw new Error("Active chat tab is required to reach MetaMask.");
  }

  await ensureWalletBridgeLoaded(tabId);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (params) => {
      if (typeof window.__ninkAnchorProof !== "function") {
        throw new Error(
          "NINK wallet bridge failed to load. Refresh the chat tab and try again."
        );
      }
      return await window.__ninkAnchorProof(params);
    },
    args: [injectionArgs],
  });

  if (!results?.length) {
    throw new Error("Could not inject wallet bridge into the chat tab.");
  }

  let jsonResult = results[0]?.result;
  if (typeof jsonResult !== "string" || !jsonResult) {
    jsonResult = await readAnchorResultFromDom(tabId);
  }

  if (typeof jsonResult !== "string" || !jsonResult) {
    throw new Error(
      "MetaMask did not return anchor data. Confirm the MetaMask popup on the chat tab (not the extension popup), or turn Local test mode back on."
    );
  }

  return JSON.parse(jsonResult);
}

export function walletProbeErrorMessage(probe) {
  if (probe?.ok) {
    return null;
  }

  if (probe?.reason === "no-wallet") {
    return (
      "MetaMask is required for on-chain sign-off but was not found on this tab. " +
      "Install MetaMask (metamask.io), unlock it, refresh the chat page, " +
      "or turn Local test mode ON to skip the wallet."
    );
  }

  return (
    "Could not detect a wallet on the active chat tab. Refresh the page and try again, " +
    "or turn Local test mode ON."
  );
}
