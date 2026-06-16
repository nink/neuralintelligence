export async function requestWalletConnectOnTab(tabId) {
  if (!tabId) {
    return { ok: false, reason: "no-tab" };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        const ethereum = window.ethereum;
        if (!ethereum) {
          return { ok: false, reason: "no-wallet" };
        }

        try {
          const accounts = await ethereum.request({ method: "eth_requestAccounts" });
          const address = accounts?.[0] || null;
          if (!address) {
            return { ok: false, reason: "no-account" };
          }
          return { ok: true, address };
        } catch (error) {
          return {
            ok: false,
            reason: error?.message || "rejected",
          };
        }
      },
    });

    return results?.[0]?.result || { ok: false, reason: "probe-failed" };
  } catch (error) {
    const message = error?.message || "inject-failed";
    if (/cannot access|cannot script|restricted/i.test(message)) {
      return { ok: false, reason: "restricted-page" };
    }
    return { ok: false, reason: message };
  }
}

export function walletConnectErrorMessage(result) {
  if (result?.ok) {
    return null;
  }

  if (result?.reason === "no-wallet") {
    return (
      "MetaMask was not found on this tab. Install MetaMask, unlock it, refresh the chat page, then try again."
    );
  }

  if (result?.reason === "restricted-page") {
    return "This page cannot host wallet connection. Open a supported AI chat tab and try again.";
  }

  if (result?.reason === "no-account") {
    return "MetaMask did not return an account. Unlock MetaMask and try again.";
  }

  if (/reject/i.test(String(result?.reason || ""))) {
    return "Wallet connection was rejected in MetaMask.";
  }

  return result?.reason || "Could not connect wallet on this tab.";
}

export async function readMetaMaskAddressOnTab(tabId) {
  if (!tabId) {
    return null;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        const ethereum = window.ethereum;
        if (!ethereum) {
          return null;
        }
        try {
          const accounts = await ethereum.request({ method: "eth_accounts" });
          return accounts?.[0] || null;
        } catch (_error) {
          return null;
        }
      },
    });

    return result || null;
  } catch (_error) {
    return null;
  }
}
