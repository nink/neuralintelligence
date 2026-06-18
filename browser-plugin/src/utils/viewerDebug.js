const LOG_KEY = "viewerDebugLog";
const MAX_ENTRIES = 100;

function readStorageArea() {
  return chrome.storage?.local || null;
}

export async function appendViewerDebugLog(event, detail = {}) {
  const area = readStorageArea();
  if (!area) {
    console.warn("[NINK viewer debug]", event, detail);
    return null;
  }

  const entry = {
    at: new Date().toISOString(),
    event,
    detail: detail && typeof detail === "object" ? detail : { value: detail },
    extensionId: chrome.runtime?.id || null,
    version: chrome.runtime?.getManifest?.()?.version || null,
  };

  const stored = await area.get(LOG_KEY);
  const log = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
  log.push(entry);
  while (log.length > MAX_ENTRIES) {
    log.shift();
  }
  await area.set({ [LOG_KEY]: log });
  return entry;
}

export async function readViewerDebugLog() {
  const area = readStorageArea();
  if (!area) {
    return [];
  }

  const stored = await area.get(LOG_KEY);
  return Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
}

export async function clearViewerDebugLog() {
  const area = readStorageArea();
  if (!area) {
    return;
  }
  await area.remove(LOG_KEY);
}

export function formatViewerDebugLog(log = []) {
  return log
    .map((entry) => {
      const detail = entry.detail ? JSON.stringify(entry.detail) : "";
      return `${entry.at} [${entry.event}] v${entry.version || "?"} ${detail}`;
    })
    .join("\n");
}
