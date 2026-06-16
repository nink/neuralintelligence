/**
 * Injected into the tab MAIN world where MetaMask sets window.ethereum.
 * Loaded via chrome.scripting.executeScript files[] — must stay self-contained.
 */
(function initNinkWalletAnchor() {
  function normalizeTxHash(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "object") {
      return value.hash || value.transactionHash || value.txHash || null;
    }
    return String(value);
  }

  function getEthereumProvider() {
    const eth = window.ethereum;
    if (!eth) {
      return null;
    }
    if (Array.isArray(eth.providers) && eth.providers.length) {
      return eth.providers.find((provider) => provider.isMetaMask) || eth.providers[0];
    }
    return eth;
  }

  async function waitForReceipt(ethereum, txHash, maxAttempts, delayMs) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const receipt = await ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });
      if (receipt) {
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }

  async function sendContractTx(ethereum, from, to, data) {
    const sendResult = await ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to,
          data,
        },
      ],
    });

    const txHash = normalizeTxHash(sendResult);
    if (!txHash) {
      throw new Error("MetaMask did not return a transaction hash.");
    }

    const receipt = await waitForReceipt(ethereum, txHash, 60, 500);
    if (!receipt) {
      throw new Error("Transaction was sent but no receipt arrived in time.");
    }

    return receipt;
  }

  window.__ninkAnchorProof = async function ninkAnchorProof(params) {
    const ethereum = getEthereumProvider();
    if (!ethereum) {
      throw new Error(
        "No MetaMask wallet on this tab. Install the MetaMask browser extension, unlock it, refresh this page, and try again."
      );
    }

    await ethereum.request({ method: "eth_requestAccounts" });

    const chainIdHex = await ethereum.request({ method: "eth_chainId" });
    const chainId = parseInt(chainIdHex, 16);
    if (params.expectedChainId && chainId !== params.expectedChainId) {
      throw new Error(
        "Wallet is on chain " +
          chainId +
          ", but NINK expects chain " +
          params.expectedChainId +
          ". In MetaMask add/switch to Localhost 8545 (chain ID 31337)."
      );
    }

    const accounts = await ethereum.request({ method: "eth_accounts" });
    const from = accounts && accounts[0];
    if (!from) {
      throw new Error("MetaMask is installed but no account is selected.");
    }

    if (params.approveCallData && params.tokenAddress) {
      await sendContractTx(ethereum, from, params.tokenAddress, params.approveCallData);
    }

    const anchorCallData = params.anchorCallData || params.callData;
    if (!anchorCallData || !params.registryAddress) {
      throw new Error("Missing anchor transaction data.");
    }

    const anchorReceipt = await sendContractTx(
      ethereum,
      from,
      params.registryAddress,
      anchorCallData
    );

    const payload = JSON.stringify({
      transactionHash:
        normalizeTxHash(anchorReceipt.transactionHash) ||
        normalizeTxHash(anchorReceipt.hash),
      blockNumber: anchorReceipt.blockNumber
        ? parseInt(anchorReceipt.blockNumber, 16)
        : null,
      validatorAddress: from,
      chainId,
      registryAddress: params.registryAddress,
    });

    document.documentElement.setAttribute("data-nink-anchor-result", payload);
    return payload;
  };
})();
