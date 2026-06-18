(function () {
  const LOG_KEY = "viewerDebugLog";
  const MAX_ENTRIES = 100;

  function getArea() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
      ? chrome.storage.local
      : null;
  }

  function appendViewerDebugLog(event, detail) {
    const area = getArea();
    const entry = {
      at: new Date().toISOString(),
      event: String(event || "LOG"),
      detail: detail && typeof detail === "object" ? detail : { value: detail },
      extensionId: chrome.runtime?.id || null,
      version: chrome.runtime?.getManifest?.()?.version || null,
      page: "viewer.html",
    };

    if (!area) {
      console.warn("[NINK viewer debug]", entry);
      return Promise.resolve(entry);
    }

    return new Promise((resolve) => {
      area.get(LOG_KEY, (stored) => {
        const log = Array.isArray(stored?.[LOG_KEY]) ? stored[LOG_KEY] : [];
        log.push(entry);
        while (log.length > MAX_ENTRIES) {
          log.shift();
        }
        area.set({ [LOG_KEY]: log }, () => resolve(entry));
      });
    });
  }

  function readViewerDebugLog() {
    const area = getArea();
    if (!area) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      area.get(LOG_KEY, (stored) => {
        resolve(Array.isArray(stored?.[LOG_KEY]) ? stored[LOG_KEY] : []);
      });
    });
  }

  function clearViewerDebugLog() {
    const area = getArea();
    if (!area) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      area.remove(LOG_KEY, resolve);
    });
  }

  function formatViewerDebugLog(log) {
    return (log || [])
      .map((entry) => {
        const detail = entry.detail ? JSON.stringify(entry.detail) : "";
        return `${entry.at} [${entry.event}] v${entry.version || "?"} ${detail}`;
      })
      .join("\n");
  }

  globalThis.__NINK_appendViewerDebugLog__ = appendViewerDebugLog;
  globalThis.__NINK_readViewerDebugLog__ = readViewerDebugLog;
  globalThis.__NINK_clearViewerDebugLog__ = clearViewerDebugLog;
  globalThis.__NINK_formatViewerDebugLog__ = formatViewerDebugLog;
})();
