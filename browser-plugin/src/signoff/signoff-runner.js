import {
  buildSignOffSuccessMessage,
  executeSignOff,
  triggerNinkSignOffDownloads,
} from "./runSignOffPipeline.js";
import { openSessionViewerWindow } from "../utils/openViewer.js";

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

function openSessionViewer() {
  openSessionViewerWindow().catch((error) => {
    console.error("Could not open viewer window:", error);
  });
}

document.getElementById("open-viewer-btn").addEventListener("click", openSessionViewer);

async function main() {
  const params = await readSignOffParams();

  if (!params?.chatTabId) {
    setRunnerStatus(
      "No sign-off session found. Close this window, open your chat tab, and click Sign-Off from the NINK popup again.",
      "error"
    );
    return;
  }

  const noteEl = document.getElementById("runner-note");
  if (noteEl) {
    if (params.useWalletMode) {
      noteEl.textContent =
        "Keep this window open. MetaMask prompts appear on your chat tab — confirm approve, then anchor. Save both files when Chrome asks.";
    } else if (params.useDevStubs) {
      noteEl.textContent =
        "Keep this window open until both files save. Choose save locations when Chrome asks.";
    } else {
      noteEl.textContent =
        "Keep this window open until both files save. No MetaMask needed — NINK cloud handles anchoring.";
    }
  }

  try {
    setRunnerStatus(
      params.useDevStubs
        ? "Capturing and encrypting session…"
        : params.useWalletMode
          ? "Capturing session… MetaMask will ask you to confirm on your chat tab."
          : "Capturing session… anchoring via your NINK account."
    );

    const result = await executeSignOff(params.useDevStubs, params.chatTabId, setRunnerStatus);

    setRunnerStatus(
      params.useDevStubs
        ? "Saving encrypted session files…"
        : params.useWalletMode
          ? "Anchor complete. Choose where to save your .nink file…"
          : "Sign-off complete. Choose where to save your .nink file…"
    );
    const { ninkFilename, keyFilename } = await triggerNinkSignOffDownloads(
      result.completedPackage,
      result.aesKeyBase64
    );

    await chrome.storage.local.set({
      signOffOutcome: {
        status: "success",
        message:
          "Files downloaded. Open Session Viewer below to view and verify your session.",
        at: new Date().toISOString(),
        ninkFilename,
        keyFilename,
      },
    });
    await chrome.storage.local.remove("signOffParams");
    setRunnerStatus(
      `${buildSignOffSuccessMessage(result, ninkFilename, keyFilename)} Drop both files in Session Viewer to verify. Closing in a few seconds…`,
      "success"
    );
    document.getElementById("open-viewer-btn").hidden = false;

    setTimeout(() => {
      window.close();
    }, 3000);
  } catch (error) {
    await chrome.storage.local.set({
      signOffOutcome: {
        status: "error",
        message: error.message,
        at: new Date().toISOString(),
      },
    });
    await chrome.storage.local.remove("signOffParams");
    setRunnerStatus(`Error: ${error.message}`, "error");
  }
}

main();
