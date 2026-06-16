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
