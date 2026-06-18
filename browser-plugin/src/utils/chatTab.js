import { isSupportedChatUrl } from "../config/chatPlatforms.js";

export const CONTENT_SCRIPT_PATHS = [
  "src/config/chatPlatforms.global.js",
  "src/content/scrapers.js",
];

export function isSupportedChatTab(tab) {
  return isSupportedChatUrl(String(tab?.url || ""));
}

export function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs);
    });
  });
}

export function getChatTabById(chatTabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(chatTabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function pickBestChatTab(tabs) {
  const supported = tabs.filter(isSupportedChatTab);
  if (!supported.length) {
    return null;
  }

  supported.sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0));
  return supported[0];
}

export async function resolveChatTabForSignOff() {
  const [activeTab] = await queryTabs({ active: true, lastFocusedWindow: true });
  if (activeTab?.id && isSupportedChatTab(activeTab)) {
    return activeTab;
  }

  const windowTab = pickBestChatTab(await queryTabs({ lastFocusedWindow: true }));
  if (windowTab) {
    return windowTab;
  }

  const anyTab = pickBestChatTab(await queryTabs({}));
  if (anyTab) {
    return anyTab;
  }

  throw new Error(
    "Open a supported AI chat tab (ChatGPT, Gemini, Claude, etc.) before sign-off."
  );
}

async function readScraperState(tabId, expectedBuild) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (build) => ({
      ready:
        typeof globalThis.__NINK_scrapeChatSession__ === "function" &&
        String(globalThis.__NINK_SCRAPER_BUILD__ || "") === String(build),
      hasScrape: typeof globalThis.__NINK_scrapeChatSession__ === "function",
      build: globalThis.__NINK_SCRAPER_BUILD__ || null,
    }),
    args: [expectedBuild],
  });

  return result || { ready: false, hasScrape: false, build: null };
}

const scraperInjectionByTab = new Map();

async function injectScraperOnce(tabId, expectedBuild) {
  const key = String(tabId);
  if (scraperInjectionByTab.has(key)) {
    return scraperInjectionByTab.get(key);
  }

  const injection = (async () => {
    const existing = await readScraperState(tabId, expectedBuild);
    if (existing.ready || existing.hasScrape) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (build) => {
        globalThis.__NINK_SCRAPER_BUILD__ = build;
      },
      args: [expectedBuild],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_PATHS,
    });
  })();

  scraperInjectionByTab.set(key, injection);

  try {
    await injection;
  } finally {
    scraperInjectionByTab.delete(key);
  }
}

export async function ensureScraperReadyOnTab(tabId, expectedBuild = chrome.runtime.getManifest().version) {
  if (!tabId) {
    return { ok: false, message: "Missing chat tab." };
  }

  let state = await readScraperState(tabId, expectedBuild);
  if (state.ready) {
    return { ok: true };
  }

  if (state.hasScrape && state.build !== expectedBuild) {
    return {
      ok: false,
      message: `Extension updated to v${expectedBuild}. Refresh your chat tab once, then try sign-off again.`,
    };
  }

  if (!state.hasScrape) {
    try {
      await injectScraperOnce(tabId, expectedBuild);
    } catch (error) {
      return {
        ok: false,
        message: error?.message || "Could not load capture on this chat tab.",
      };
    }
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    state = await readScraperState(tabId, expectedBuild);
    if (state.ready) {
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    ok: false,
    message:
      "Capture could not start on this tab. Refresh your chat tab once, then try sign-off again.",
  };
}

export async function warmInjectScraperOnTab(tabId) {
  const result = await ensureScraperReadyOnTab(tabId);
  return result.ok;
}

export async function warmInjectOpenChatTabs() {
  const tabs = await queryTabs({});
  let injected = 0;

  for (const tab of tabs) {
    if (!tab?.id || !isSupportedChatTab(tab)) {
      continue;
    }

    if (await warmInjectScraperOnTab(tab.id)) {
      injected += 1;
    }
  }

  return injected;
}
