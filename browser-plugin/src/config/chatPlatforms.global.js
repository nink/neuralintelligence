globalThis.__NINK_CHAT_PLATFORMS__ = [
  { id: "chatgpt", hosts: ["chatgpt.com"] },
  { id: "gemini", hosts: ["gemini.google.com"] },
  { id: "claude", hosts: ["claude.ai"] },
  { id: "grok", hosts: ["grok.com", "grok.x.ai"] },
  { id: "x-grok", hosts: ["x.com", "twitter.com"], pathPattern: "grok" },
  { id: "perplexity", hosts: ["perplexity.ai"] },
  { id: "copilot", hosts: ["copilot.microsoft.com"] },
  { id: "poe", hosts: ["poe.com"] },
  { id: "meta-ai", hosts: ["meta.ai"] },
  { id: "deepseek", hosts: ["chat.deepseek.com"] },
  { id: "mistral", hosts: ["chat.mistral.ai"] },
  { id: "you", hosts: ["you.com"] },
  { id: "pi", hosts: ["pi.ai"] },
  { id: "character", hosts: ["character.ai"] },
  { id: "huggingface", hosts: ["huggingface.co"], pathPattern: "chat" },
];

globalThis.__NINK_GENERIC_SELECTORS__ = {
  grok: {
    containers: [
      "main",
      '[id^="response-"]',
      ".message-bubble",
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
    ],
    user: [
      '[data-testid="user-message"]',
      '[data-testid*="user-message"]',
      '[data-message-author-role="user"]',
    ],
    assistant: [
      '[data-testid="assistant-message"]',
      '[data-testid="grok-response"]',
      '[data-testid*="assistant-message"]',
      ".response-content-markdown",
      '[data-message-author-role="assistant"]',
    ],
    images: [
      '[data-testid="assistant-message"] img',
      '[data-testid="user-message"] img',
      '[id^="response-"] img',
      ".message-bubble img",
      ".response-content-markdown img",
      'img[src*="estuary" i]',
      'img[srcset*="estuary" i]',
      'img[src*="file_" i]',
      "picture img",
      'main img',
      'img[alt*="Generated" i]',
    ],
  },
  perplexity: {
    containers: ["main", '[class*="thread"]', '[class*="Conversation"]'],
    user: [
      '[data-testid="user-message"]',
      '[class*="UserMessage"]',
      '[class*="user-message"]',
      '[data-message-author-role="user"]',
    ],
    assistant: [
      '[data-testid="assistant-message"]',
      '[class*="BotMessage"]',
      '[class*="assistant-message"]',
      ".prose",
      '[data-message-author-role="assistant"]',
    ],
    images: ["main img", ".prose img", '[class*="message"] img'],
  },
  copilot: {
    containers: ["main", '[data-testid*="conversation"]', '[class*="conversation"]'],
    user: [
      '[data-content="user-message"]',
      '[data-testid="user-message"]',
      '[data-message-author-role="user"]',
      '[class*="user-message"]',
    ],
    assistant: [
      '[data-content="ai-message"]',
      '[data-testid="bot-message"]',
      '[data-message-author-role="assistant"]',
      ".ac-textBlock",
      '[class*="assistant-message"]',
    ],
    images: ["main img", '[data-content="ai-message"] img', ".ac-textBlock img"],
  },
  poe: {
    containers: ["main", '[class*="Chat"]', '[class*="chat"]'],
    user: [
      '[data-testid="user-message"]',
      '[class*="HumanMessage"]',
      '[class*="humanMessage"]',
      '[data-message-author-role="user"]',
    ],
    assistant: [
      '[data-testid="bot-message"]',
      '[class*="BotMessage"]',
      '[class*="botMessage"]',
      '[data-message-author-role="assistant"]',
    ],
    images: ["main img", '[class*="Message"] img'],
  },
  "meta-ai": {
    containers: ["main", '[role="main"]'],
    user: [
      '[data-testid="user-message"]',
      '[data-message-author-role="user"]',
      '[class*="user-message"]',
    ],
    assistant: [
      '[data-testid="assistant-message"]',
      '[data-message-author-role="assistant"]',
      '[class*="assistant-message"]',
    ],
    images: ["main img", '[data-testid*="message"] img'],
  },
  deepseek: {
    containers: ["main", '[class*="conversation"]'],
    user: [
      '[data-message-author-role="user"]',
      '[class*="user-message"]',
      '[data-testid="user-message"]',
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      '[class*="assistant-message"]',
      '[data-testid="assistant-message"]',
    ],
    images: ["main img", '[data-message-author-role] img'],
  },
  mistral: {
    containers: ["main", '[class*="conversation"]'],
    user: [
      '[data-message-author-role="user"]',
      '[data-testid="user-message"]',
      '[class*="user-message"]',
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]',
      '[class*="assistant-message"]',
    ],
    images: ["main img"],
  },
  you: {
    containers: ["main", '[class*="chat"]'],
    user: [
      '[data-testid="user-message"]',
      '[data-message-author-role="user"]',
      '[class*="UserMessage"]',
    ],
    assistant: [
      '[data-testid="assistant-message"]',
      '[data-message-author-role="assistant"]',
      '[class*="AssistantMessage"]',
    ],
    images: ["main img", '[class*="message"] img'],
  },
  pi: {
    containers: ["main", '[class*="chat"]'],
    user: [
      '[data-testid="user-message"]',
      '[data-message-author-role="user"]',
      '[class*="user-message"]',
    ],
    assistant: [
      '[data-testid="assistant-message"]',
      '[data-message-author-role="assistant"]',
      '[class*="assistant-message"]',
    ],
    images: ["main img"],
  },
  character: {
    containers: ["main", '[class*="chat"]'],
    user: [
      '[data-testid="user-message"]',
      '[class*="user-message"]',
      '[data-message-author-role="user"]',
    ],
    assistant: [
      '[data-testid="bot-message"]',
      '[class*="bot-message"]',
      '[data-message-author-role="assistant"]',
    ],
    images: ["main img", '[class*="message"] img'],
  },
  huggingface: {
    containers: ["main", '[class*="chat"]'],
    user: [
      '[data-message-author-role="user"]',
      '[data-testid="user-message"]',
      '[class*="user-message"]',
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]',
      '[class*="assistant-message"]',
    ],
    images: ["main img"],
  },
};

globalThis.__NINK_matchChatPlatform__ = function matchChatPlatform(host, pathname, href) {
  const normalizedHost = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
  const path = String(pathname || "");
  const fullHref = String(href || "");

  for (const platform of globalThis.__NINK_CHAT_PLATFORMS__) {
    const hostMatched = platform.hosts.some(
      (candidate) =>
        normalizedHost === candidate || normalizedHost.endsWith(`.${candidate}`)
    );

    if (!hostMatched) {
      continue;
    }

    if (platform.pathPattern) {
      const pattern = new RegExp(platform.pathPattern, "i");
      if (!pattern.test(path) && !pattern.test(fullHref)) {
        continue;
      }
    }

    return platform;
  }

  return null;
};
