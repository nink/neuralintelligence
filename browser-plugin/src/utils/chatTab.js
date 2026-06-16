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

export async function warmInjectScraperOnTab(tabId) {
  if (!tabId) {
    return false;
  }

  const expectedBuild = chrome.runtime.getManifest().version;

  try {
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

    return true;
  } catch (_error) {
    return false;
  }
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
