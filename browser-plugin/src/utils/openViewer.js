const VIEWER_PAGE = "viewer.html";

import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import {
  appendViewerDebugLog,
  formatViewerDebugLog,
  readViewerDebugLog,
} from "./viewerDebug.js";
import {
  isStrictCloudModeEnabled,
  parseNinkPackageId,
} from "./strictCloudMode.js";

function viewerUrl() {
  return chrome.runtime.getURL(VIEWER_PAGE);
}

function runtimeErrorMessage() {
  return chrome.runtime.lastError?.message || "";
}

/**
 * Stash session files for the viewer tab (session storage only — never chrome.storage.local).
 * Key material is omitted for cloud-backed packages when strict cloud mode is on.
 */
export async function stashViewerPendingFiles(payload) {
  const stored = await chrome.storage.local.get("ninkConfig");
  const config = { ...DEFAULT_NINK_CONFIG, ...stored.ninkConfig };
  const packageId = parseNinkPackageId(payload.ninkText);
  const omitKey = packageId && isStrictCloudModeEnabled(config);

  const entry = {
    ninkText: payload.ninkText,
    ninkFilename: payload.ninkFilename || "",
    at: Date.now(),
  };

  if (packageId) {
    entry.packageId = packageId;
  }

  if (!omitKey && payload.keyText) {
    entry.keyText = payload.keyText;
    entry.keyFilename = payload.keyFilename || "";
  }

  if (!chrome.storage?.session) {
    throw new Error("Extension session storage is unavailable.");
  }

  await chrome.storage.session.set({ viewerPendingFiles: entry });
  await chrome.storage.local.remove("viewerPendingFiles");

  await appendViewerDebugLog("STASH_VIEWER_PENDING", {
    ninkFilename: entry.ninkFilename,
    keyFilename: entry.keyFilename || "(omitted)",
    packageId: entry.packageId || null,
    strictCloudMode: isStrictCloudModeEnabled(config),
    ninkBytes: entry.ninkText?.length || 0,
    keyBytes: entry.keyText?.length || 0,
  });
}

/**
 * Open viewer in a normal tab (reliable file picker on Windows; popup windows often fail).
 * Returns tab metadata for diagnostics.
 */
export async function openSessionViewerWindow() {
  const url = viewerUrl();
  await appendViewerDebugLog("OPEN_VIEWER_START", {
    url,
    extensionId: chrome.runtime.id,
  });

  const tab = await chrome.tabs.create({ url, active: true });
  const lastError = runtimeErrorMessage();
  if (lastError) {
    await appendViewerDebugLog("OPEN_VIEWER_ERROR", { message: lastError, url });
    throw new Error(lastError);
  }

  const result = {
    url,
    tabId: tab?.id ?? null,
    windowId: tab?.windowId ?? null,
  };
  await appendViewerDebugLog("OPEN_VIEWER_OK", result);
  return result;
}

/** Ask the service worker to open the viewer (popup action closes before async work finishes). */
export function requestOpenSessionViewer() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "OPEN_VIEWER" }, (response) => {
      const lastError = runtimeErrorMessage();
      if (lastError) {
        reject(new Error(lastError));
        return;
      }

      if (response?.status === "ERROR") {
        reject(new Error(response.message || "Could not open viewer."));
        return;
      }

      resolve(response);
    });
  });
}

const PICK_FILES_PAGE = "pick-files.html";

/** Dedicated picker popup — reliable on Windows (viewer tab file input often fails). */
export async function openFilePickerWindow() {
  const url = chrome.runtime.getURL(PICK_FILES_PAGE);
  await appendViewerDebugLog("OPEN_FILE_PICKER_START", { url });

  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: 480,
    height: 360,
    focused: true,
  });

  const lastError = runtimeErrorMessage();
  if (lastError) {
    await appendViewerDebugLog("OPEN_FILE_PICKER_ERROR", { message: lastError });
    throw new Error(lastError);
  }

  await appendViewerDebugLog("OPEN_FILE_PICKER_OK", { url, windowId: created?.id ?? null });
  return created;
}

export function requestOpenFilePickerWindow() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "OPEN_FILE_PICKER" }, (response) => {
      const lastError = runtimeErrorMessage();
      if (lastError) {
        reject(new Error(lastError));
        return;
      }

      if (response?.status === "ERROR") {
        reject(new Error(response.message || "Could not open file picker."));
        return;
      }

      resolve(response);
    });
  });
}

export { formatViewerDebugLog, readViewerDebugLog, appendViewerDebugLog };
