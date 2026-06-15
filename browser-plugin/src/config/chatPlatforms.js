export const CHAT_PLATFORMS = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    hosts: ["chatgpt.com"],
  },
  {
    id: "gemini",
    label: "Gemini",
    hosts: ["gemini.google.com"],
  },
  {
    id: "claude",
    label: "Claude",
    hosts: ["claude.ai"],
  },
  {
    id: "grok",
    label: "Grok",
    hosts: ["grok.com", "grok.x.ai"],
  },
  {
    id: "x-grok",
    label: "Grok on X",
    hosts: ["x.com", "twitter.com"],
    pathPattern: /grok/i,
  },
  {
    id: "perplexity",
    label: "Perplexity",
    hosts: ["perplexity.ai"],
  },
  {
    id: "copilot",
    label: "Microsoft Copilot",
    hosts: ["copilot.microsoft.com"],
  },
  {
    id: "poe",
    label: "Poe",
    hosts: ["poe.com"],
  },
  {
    id: "meta-ai",
    label: "Meta AI",
    hosts: ["meta.ai"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hosts: ["chat.deepseek.com"],
  },
  {
    id: "mistral",
    label: "Mistral",
    hosts: ["chat.mistral.ai"],
  },
  {
    id: "you",
    label: "You.com",
    hosts: ["you.com"],
  },
  {
    id: "pi",
    label: "Pi",
    hosts: ["pi.ai"],
  },
  {
    id: "character",
    label: "Character.AI",
    hosts: ["character.ai"],
  },
  {
    id: "huggingface",
    label: "HuggingChat",
    hosts: ["huggingface.co"],
    pathPattern: /chat/i,
  },
];

export function normalizeHostname(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/^www\./, "");
}

export function matchChatPlatform(url) {
  let parsed;

  try {
    parsed = new URL(String(url || ""));
  } catch (_error) {
    return null;
  }

  const host = normalizeHostname(parsed.hostname);
  const href = parsed.href;

  for (const platform of CHAT_PLATFORMS) {
    const hostMatched = platform.hosts.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`)
    );

    if (!hostMatched) {
      continue;
    }

    if (platform.pathPattern && !platform.pathPattern.test(href)) {
      continue;
    }

    return platform;
  }

  return null;
}

export function isSupportedChatUrl(url) {
  return Boolean(matchChatPlatform(url));
}

export function getSupportedHostPermissions() {
  const hosts = new Set();

  for (const platform of CHAT_PLATFORMS) {
    for (const host of platform.hosts) {
      hosts.add(`https://${host}/*`);
      hosts.add(`https://*.${host}/*`);
    }
  }

  return [...hosts];
}
