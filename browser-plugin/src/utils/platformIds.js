/** Maps chat hostnames to on-chain platform IDs (uint32). */
export const PLATFORM_HOST_IDS = {
  "chatgpt.com": 1,
  "claude.ai": 2,
  "gemini.google.com": 3,
  "grok.com": 4,
  "grok.x.ai": 5,
  "perplexity.ai": 6,
  "copilot.microsoft.com": 7,
  "poe.com": 8,
  "meta.ai": 9,
  "chat.deepseek.com": 10,
  "chat.mistral.ai": 11,
  "you.com": 12,
  "pi.ai": 13,
  "character.ai": 14,
  "huggingface.co": 15,
};

const PLATFORM_STRING_IDS = {
  chatgpt: 1,
  claude: 2,
  gemini: 3,
  grok: 4,
  "x-grok": 5,
  perplexity: 6,
  copilot: 7,
  poe: 8,
  "meta-ai": 9,
  deepseek: 10,
  mistral: 11,
  you: 12,
  pi: 13,
  character: 14,
  huggingface: 15,
};

export function resolvePlatformIdFromTab(tabUrl, sourcePlatform = "") {
  try {
    const host = new URL(String(tabUrl || "")).hostname.replace(/^www\./, "").toLowerCase();
    if (PLATFORM_HOST_IDS[host] != null) {
      return PLATFORM_HOST_IDS[host];
    }

    if (host === "x.com" || host === "twitter.com") {
      if (String(tabUrl || "").toLowerCase().includes("grok")) {
        return PLATFORM_STRING_IDS["x-grok"];
      }
    }
  } catch (_error) {
    // Fall through to sourcePlatform mapping.
  }

  const normalized = String(sourcePlatform || "").toLowerCase();
  if (PLATFORM_STRING_IDS[normalized] != null) {
    return PLATFORM_STRING_IDS[normalized];
  }

  return 0;
}
