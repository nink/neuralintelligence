import {
  buildSignOffSuccessMessage,
  executeSignOff,
  triggerNinkSignOffDownloads,
} from "./runSignOffPipeline.js";

function readSignOffParams() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("signOffParams", (stored) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(stored.signOffParams || null);
    });
  });
}

function setRunnerStatus(text, tone = "info") {
  const statusEl = document.getElementById("runner-status");
  statusEl.textContent = text;
  statusEl.className = tone === "success" ? "success" : tone === "error" ? "error" : "";
}

async function main() {
  const params = await readSignOffParams();

  if (!params?.chatTabId) {
    setRunnerStatus(
      "No sign-off session found. Close this window, open your chat tab, and click Sign-Off from the NINK popup again.",
      "error"
    );
    return;
  }

  try {
    setRunnerStatus(
      params.useDevStubs
        ? "Capturing and encrypting session…"
        : "Capturing session… MetaMask will ask you to confirm on your chat tab."
    );

    const result = await executeSignOff(params.useDevStubs, params.chatTabId, setRunnerStatus);

    setRunnerStatus("On-chain anchor complete. Choose where to save your .nink file…");
    const { ninkFilename, keyFilename } = await triggerNinkSignOffDownloads(
      result.completedPackage,
      result.aesKeyBase64
    );

    await chrome.storage.local.remove("signOffParams");
    setRunnerStatus(buildSignOffSuccessMessage(result, ninkFilename, keyFilename), "success");
  } catch (error) {
    setRunnerStatus(`Error: ${error.message}`, "error");
  }
}

main();
