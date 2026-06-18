(() => {
  if (typeof globalThis.__NINK_scrapeChatSession__ === "function") {
    return;
  }

  if (typeof globalThis.__NINK_SCRAPER_BUILD__ !== "string") {
    globalThis.__NINK_SCRAPER_BUILD__ = "legacy-unset";
  }

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanMarkdownArtifacts(text) {
  return normalizeText(text)
    .replace(/^(Copy code|Copy|Regenerate|Edit message|Retry|Share)\s*$/gim, "")
    .replace(/\[(?:Copied|Copy)\]\([^)]+\)/gi, "")
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "")
    )
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function queryAll(selectors, root = null) {
  const scope = root || getScrapeRoot();
  const seen = new Set();
  const elements = [];

  for (const selector of selectors) {
    scope.querySelectorAll(selector).forEach((el) => {
      if (seen.has(el)) {
        return;
      }
      seen.add(el);
      elements.push(el);
    });
  }

  return elements;
}

function getScrapeRoot() {
  return document.querySelector("main") || document.body;
}

function queryElements(selector, options = {}) {
  const scope = options.root || getScrapeRoot();
  if (options.useDeepQuery) {
    return querySelectorAllDeep(selector, scope);
  }
  return Array.from(scope.querySelectorAll(selector));
}

function querySelectorAllDeep(selector, root = document) {
  const results = [];

  const visit = (node) => {
    if (!node?.querySelectorAll) {
      return;
    }

    node.querySelectorAll(selector).forEach((element) => results.push(element));
    node.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
    });
  };

  visit(root);
  return results;
}

function elementHasSubstantiveContent(element) {
  if (!element) {
    return false;
  }

  const text = normalizeText(element.innerText || element.textContent || "");
  if (text) {
    return true;
  }

  if (turnHasChatMedia(element)) {
    return true;
  }

  const html = String(element.innerHTML || "").trim();
  return html.length > 40;
}

function dedupeNestedElements(elements) {
  return elements.filter(
    (element) =>
      !elements.some(
        (other) => other !== element && other.contains(element)
      )
  );
}

function sortByDocumentOrder(elements) {
  return [...elements].sort((left, right) => {
    if (left === right) {
      return 0;
    }

    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }
    return 0;
  });
}

function buildMessage(role, text, index, options = {}) {
  const normalized = cleanMarkdownArtifacts(text);
  if (!normalized && !options.allowEmpty) {
    return null;
  }

  return {
    index,
    role: normalizeRoleAttr(role),
    text: normalized,
    timestamp: Date.now(),
  };
}

function normalizeRoleAttr(role) {
  const value = String(role || "").toLowerCase();
  if (value === "user" || value === "human") {
    return "user";
  }
  if (value === "assistant" || value === "model") {
    return "assistant";
  }
  return value || "assistant";
}

function assignConversationIndices(messages) {
  return safeArray(messages).map((message, index) => ({
    ...message,
    index: index + 1,
  }));
}

function buildConversationFromTurnEntries(entries) {
  const validEntries = safeArray(entries).filter((entry) => entry?.message && entry?.element);

  if (!validEntries.length) {
    return { messages: [], messageTurns: [] };
  }

  const messages = assignConversationIndices(validEntries.map((entry) => entry.message));
  const messageTurns = validEntries.map((entry, index) => ({
    index: messages[index].index,
    role: messages[index].role,
    element: entry.element,
  }));

  return { messages, messageTurns };
}

function getMessageTurnContainer(element) {
  if (!element) {
    return element;
  }

  return (
    element.closest('[data-testid^="conversation-turn"]') ||
    element.closest("article") ||
    element.closest('[id^="response-"]') ||
    element.closest("ms-chat-turn") ||
    element.closest(".chat-turn-container") ||
    element.closest('[class*="chat-turn"]') ||
    element
  );
}

const DOCUMENT_EXTENSION_PATTERN =
  "pdf|docx?|xlsx?|pptx?|txt|csv|json|md|markdown|rtf|odt|ods|zip|html?|xml|yaml|yml|wav|wave|mp3|m4a|ogg|flac|aac|weba|aiff?|mid|midi";

function extractInferredGeneratedFilenames(text) {
  const source = String(text || "");
  const results = [];

  if (/download the wav file|generated the audio file/i.test(source)) {
    results.push("generated-audio.wav");
  }

  if (/download the mp3 file/i.test(source)) {
    results.push("generated-audio.mp3");
  } else if (/download the audio file/i.test(source) && !/\.wav\b/i.test(source)) {
    results.push("generated-audio.wav");
  }

  return results;
}

function extractAllDocumentFilenames(text) {
  const seen = new Set();
  const results = [];
  const add = (name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    results.push(trimmed);
  };

  const source = String(text || "");
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const linePattern = new RegExp(`^(.+\\.(${DOCUMENT_EXTENSION_PATTERN}))$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineMatch = line.match(linePattern);
    if (lineMatch) {
      add(lineMatch[1]);
      continue;
    }

    const nextLine = lines[index + 1] || "";
    if (
      /^(PDF|File|Document|TXT|CSV|JSON|Markdown|DOC|WAV|MP3|M4A|Audio|AIF)$/i.test(nextLine) &&
      /\.[^.\s/\\]+$/.test(line) &&
      new RegExp(`\\.(${DOCUMENT_EXTENSION_PATTERN})$`, "i").test(line)
    ) {
      add(line);
    }
  }

  const inlinePattern = new RegExp(`[^\\s/\\\\'"<>]+\\.(${DOCUMENT_EXTENSION_PATTERN})`, "gi");
  let match = inlinePattern.exec(source);
  while (match) {
    add(match[0]);
    match = inlinePattern.exec(source);
  }

  return filterShadowDocumentFilenames(results);
}

function extractUserFileAttachmentFilenames(text) {
  const seen = new Set();
  const results = [];

  for (const name of [
    ...extractAllDocumentFilenames(text),
    ...extractAllVideoFilenames(text),
  ]) {
    const key = String(name || "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(String(name).trim());
  }

  return filterShadowDocumentFilenames(results);
}

function extractAllDocumentFilenamesFromMessage(text) {
  const seen = new Set();
  const results = [];

  for (const name of [
    ...extractAllDocumentFilenames(text),
    ...extractInferredGeneratedFilenames(text),
  ]) {
    const key = String(name || "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(String(name).trim());
  }

  return filterShadowDocumentFilenames(results);
}

function filterShadowDocumentFilenames(filenames) {
  const list = safeArray(filenames)
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  const kept = [];
  for (const candidate of list) {
    const candidateLower = candidate.toLowerCase();
    const isShadow = kept.some((existing) => {
      const existingLower = existing.toLowerCase();
      return (
        existingLower !== candidateLower &&
        (existingLower.endsWith(candidateLower) || candidateLower.endsWith(existingLower))
      );
    });

    if (!isShadow) {
      kept.push(candidate);
    }
  }

  return kept;
}

function looksLikeAttachmentChip(element) {
  if (!element) {
    return false;
  }

  const testId = String(element.getAttribute("data-testid") || "").toLowerCase();
  if (/attachment|file|upload|chip|thumbnail|preview/.test(testId)) {
    return true;
  }

  const ariaLabel = String(element.getAttribute("aria-label") || "").toLowerCase();
  if (/remove file|attached file|file attachment|download file|remove attachment/.test(ariaLabel)) {
    return true;
  }

  const text = normalizeText(element.innerText || element.textContent || "");
  if (text.length > 0 && text.length <= 64) {
    if (/^(PDF|DOCX?|TXT|CSV|JSON|Markdown|Document|File|WAV|MP3|M4A|Audio)$/i.test(text)) {
      return true;
    }
  }

  return false;
}

function queryNodesInScope(scope, selector, useDeep = true) {
  if (!scope) {
    return [];
  }

  const nodes = useDeep
    ? querySelectorAllDeep(selector, scope)
    : Array.from(scope.querySelectorAll(selector));

  return nodes.filter((node) => scope.contains(node));
}

function scanUserTurnFileArtifacts(scope, register) {
  queryNodesInScope(scope, 'button, [role="button"]').forEach((button) => {
    const ariaLabel = String(button.getAttribute("aria-label") || "").toLowerCase();
    if (!/(remove|delete|close|detach)/.test(ariaLabel)) {
      return;
    }

    if (!/(file|attachment|document|pdf|upload|image|audio|wav|mp3|video)/.test(ariaLabel)) {
      return;
    }

    const card =
      button.closest(
        '[data-testid], article, li, [class*="group"], [class*="flex"], [class*="file"], [class*="attachment"]'
      ) || button.parentElement;

    if (!card || !scope.contains(card)) {
      return;
    }

    const filename =
      extractDocumentFilenameFromText(ariaLabel) ||
      extractDocumentFilenameFromText(card.innerText || "");
    register(card, {
      kind: "document-remove-button",
      filename,
      label: ariaLabel || normalizeText(card.innerText || ""),
    });
  });

  queryNodesInScope(scope, "img, picture img").forEach((imageElement) => {
    const alt = String(imageElement.alt || "").toLowerCase();
    const src = getImageCandidateUrl(imageElement).toLowerCase();
    if (
      !/pdf|document|page|file|scan|upload|attachment/.test(`${alt} ${src}`) &&
      !imageElement.closest('[data-testid*="file"], [data-testid*="attachment"], [class*="file"]')
    ) {
      return;
    }

    register(imageElement, {
      kind: "document-image-node",
      filename: extractDocumentFilenameFromText(alt) || "document-preview",
      label: alt || "Document preview",
      sourceUrl: getImageCandidateUrl(imageElement),
    });
  });
}

function normalizeAttachmentFilename(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const baseName = trimmed.split(/[/\\]/).pop() || trimmed;
  return baseName.toLowerCase();
}

function documentFilenamesOverlap(left, right) {
  const leftName = normalizeAttachmentFilename(left);
  const rightName = normalizeAttachmentFilename(right);

  if (!leftName || !rightName) {
    return false;
  }

  if (leftName === rightName) {
    return true;
  }

  return leftName.endsWith(rightName) || rightName.endsWith(leftName);
}

function preferDocumentRecord(existing, candidate) {
  const captureRank = {
    success: 3,
    "metadata-only": 2,
    failed: 1,
    pending: 0,
  };
  const existingRank = captureRank[existing.captureStatus] ?? 0;
  const candidateRank = captureRank[candidate.captureStatus] ?? 0;
  const existingName = String(existing.filename || existing.label || "");
  const candidateName = String(candidate.filename || candidate.label || "");

  if (candidateRank > existingRank) {
    return candidate;
  }

  if (candidateRank < existingRank) {
    return existing;
  }

  if (candidate.base64 && !existing.base64) {
    return candidate;
  }

  if (existing.base64 && !candidate.base64) {
    return existing;
  }

  return candidateName.length >= existingName.length ? candidate : existing;
}

function dedupeSessionDocuments(documents) {
  const bestByAnchor = new Map();

  for (const document of safeArray(documents)) {
    const afterMessageIndex = Number(document?.afterMessageIndex);
    if (!Number.isFinite(afterMessageIndex) || afterMessageIndex <= 0) {
      continue;
    }

    const anchorBucket = bestByAnchor.get(afterMessageIndex) || [];
    let merged = false;

    for (let index = 0; index < anchorBucket.length; index += 1) {
      const existing = anchorBucket[index];
      if (
        !documentFilenamesOverlap(
          existing.filename || existing.label,
          document.filename || document.label
        )
      ) {
        continue;
      }

      anchorBucket[index] = preferDocumentRecord(existing, document);
      merged = true;
      break;
    }

    if (!merged) {
      anchorBucket.push(document);
    }

    bestByAnchor.set(afterMessageIndex, anchorBucket);
  }

  const unanchored = safeArray(documents).filter((document) => {
    const afterMessageIndex = Number(document?.afterMessageIndex);
    return !Number.isFinite(afterMessageIndex) || afterMessageIndex <= 0;
  });

  return [...bestByAnchor.values(), unanchored]
    .flat()
    .map((document, index) => ({
      ...document,
      index: index + 1,
      documentOrder: index + 1,
    }));
}

function mergeSessionDocuments(primaryDocuments, extraDocuments) {
  return dedupeSessionDocuments([...safeArray(primaryDocuments), ...safeArray(extraDocuments)]);
}

function isGeneratedChatImage(image) {
  const alt = String(image?.alt || "").toLowerCase();
  const sourceUrl = String(image?.sourceUrl || "").toLowerCase();
  return (
    alt.includes("generated image") ||
    sourceUrl.includes("estuary") ||
    sourceUrl.includes("/backend-api/") ||
    sourceUrl.includes("file_")
  );
}

function buildDocumentsFromUserTurnImages(sessionImages, messageTurns) {
  const turnByIndex = new Map(
    safeArray(messageTurns).map((turn) => [turn.index, turn])
  );
  const documents = [];

  for (const image of safeArray(sessionImages)) {
    if (image?.captureStatus !== "success" || !image?.base64) {
      continue;
    }

    const turn = turnByIndex.get(image.afterMessageIndex);
    if (!turn || turn.role !== "user") {
      continue;
    }

    const turnText = normalizeText(turn.element?.innerText || turn.element?.textContent || "");
    const filenames = extractAllDocumentFilenames(turnText);
    const alt = String(image.alt || "").toLowerCase();
    const sourceUrl = String(image.sourceUrl || "").toLowerCase();

    if (isGeneratedChatImage(image)) {
      continue;
    }

    if (filenames.length === 0) {
      continue;
    }

    const looksLikeDocPreview =
      filenames.length > 0 ||
      /pdf|document|page|scan|upload|attachment/.test(`${alt} ${sourceUrl}`);

    if (!looksLikeDocPreview) {
      continue;
    }

    documents.push({
      index: documents.length + 1,
      documentOrder: image.documentOrder ?? documents.length + 1,
      afterMessageIndex: image.afterMessageIndex,
      sourceUrl: image.sourceUrl || "",
      filename: filenames[0],
      label: filenames[0] || "Document preview (page image)",
      mimeType: "image/png",
      base64: image.base64,
      captureStatus: "success",
      captureKind: "document-image-preview",
      captureMethod: image.captureMethod || "from-user-turn-image",
      relatedImageIndex: image.index,
    });
  }

  return documents;
}

function collectRoleMessages(selectorRolePairs, options = {}) {
  const scope = options.root || getScrapeRoot();
  const useDeepQuery = options.useDeepQuery === true;
  const elementRoles = new Map();

  for (const { selector, role } of selectorRolePairs) {
    const elements = useDeepQuery
      ? querySelectorAllDeep(selector, scope)
      : Array.from(scope.querySelectorAll(selector));

    for (const element of elements) {
      if (!elementRoles.has(element)) {
        elementRoles.set(element, role);
      }
    }
  }

  const dedupedElements = sortByDocumentOrder(
    dedupeNestedElements([...elementRoles.keys()])
  );

  const entries = dedupedElements
    .map((element) => {
      const message = buildMessage(elementRoles.get(element), element.innerText, 0, {
        allowEmpty: turnHasChatMedia(getMessageTurnContainer(element)),
      });
      return message
        ? { element: getMessageTurnContainer(element), message }
        : null;
    })
    .filter(Boolean);

  return buildConversationFromTurnEntries(entries);
}

function detectPlatform() {
  const matcher = globalThis.__NINK_matchChatPlatform__;
  if (typeof matcher !== "function") {
    return null;
  }

  return matcher(
    window.location.hostname,
    window.location.pathname,
    window.location.href
  );
}

function getGenericSelectorConfig(platformId) {
  const configs = globalThis.__NINK_GENERIC_SELECTORS__;
  if (!configs || !platformId) {
    return null;
  }

  const selectorId = platformId === "x-grok" ? "grok" : platformId;
  return configs[selectorId] || null;
}

function getChatContainerSelectors(host, platformId) {
  if (host.includes("chatgpt.com")) {
    return [
      'div[data-message-author-role]:not([data-message-author-role] div[data-message-author-role])',
      '[data-testid^="conversation-turn"]',
      "main article",
      "main",
    ];
  }

  if (host.includes("gemini.google.com")) {
    return [
      ".model-response-text",
      ".model-response",
      ".query-text",
      ".user-query",
      '[data-message-author-role="user"]',
      '[data-message-author-role="model"]',
      '[data-message-author-role="assistant"]',
      "main",
    ];
  }

  if (host.includes("claude.ai")) {
    return [
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '[data-testid="human-message"]',
      '[data-testid="ai-message"]',
      ".font-claude-response",
      ".font-user-message",
      "main",
    ];
  }

  const generic = getGenericSelectorConfig(platformId);
  if (generic?.containers?.length) {
    return [...generic.containers, "main", "[role='main']"];
  }

  return ["main", "[role='main']"];
}

function getChatContainers(host, platformId) {
  const containers = dedupeNestedElements(
    queryAll(getChatContainerSelectors(host, platformId))
  );
  return containers.length > 0 ? containers : [document.body];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractBackgroundImageUrl(element) {
  const inlineStyle = element.getAttribute("style") || "";
  const inlineMatch = inlineStyle.match(/url\(["']?(.*?)["']?\)/i);
  if (inlineMatch?.[1]) {
    return inlineMatch[1].trim();
  }

  const computed = window.getComputedStyle(element).backgroundImage;
  if (!computed || computed === "none") {
    return "";
  }

  const computedMatch = computed.match(/url\(["']?(.*?)["']?\)/i);
  return computedMatch?.[1]?.trim() || "";
}

function getBestSrcsetUrl(imageElement) {
  const srcset = imageElement.getAttribute("srcset");
  if (!srcset) {
    return "";
  }

  const entries = srcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  let bestUrl = "";
  let bestWidth = 0;

  for (const entry of entries) {
    const parts = entry.split(/\s+/);
    const url = parts[0] || "";
    const width = Number.parseInt(parts[1], 10) || 0;

    if (!isRelevantImageUrl(url)) {
      continue;
    }

    if (width >= bestWidth) {
      bestWidth = width;
      bestUrl = url;
    }
  }

  if (bestUrl) {
    return bestUrl;
  }

  const fallback = entries[0]?.split(/\s+/)[0] || "";
  return isRelevantImageUrl(fallback) ? fallback : "";
}

function isLikelyGrokGeneratedImageUrl(sourceUrl) {
  const url = String(sourceUrl || "").toLowerCase();
  return (
    url.includes("estuary") ||
    url.includes("grok.com") ||
    url.includes("grok.x.ai") ||
    url.includes("x.ai/") ||
    url.includes("/file_") ||
    url.includes("generated") ||
    url.includes("imagine") ||
    url.startsWith("blob:") ||
    url.startsWith("data:image/")
  );
}

function imageRequiresPageCredentials(sourceUrl) {
  const url = String(sourceUrl || "").toLowerCase();
  return (
    isLikelyGrokGeneratedImageUrl(url) ||
    url.includes("googleusercontent.com") ||
    url.includes("openai.com")
  );
}

function isLikelyAvatar(imageElement) {
  if (
    imageElement.closest(
      '[data-testid="assistant-message"], [data-testid="user-message"], [id^="response-"], .message-bubble'
    )
  ) {
    const rect = imageElement.getBoundingClientRect();
    if (rect.width > 72 || rect.height > 72) {
      return false;
    }
  }

  if (imageElement.closest('[data-testid*="profile"], [class*="avatar"]')) {
    return true;
  }

  const rect = imageElement.getBoundingClientRect();
  return rect.width > 0 && rect.width <= 40 && rect.height > 0 && rect.height <= 40;
}

function isRelevantImageUrl(sourceUrl) {
  const url = String(sourceUrl || "").trim();
  if (!url || url.startsWith("chrome-extension://")) {
    return false;
  }

  if (
    url.startsWith("data:image/svg") &&
    url.length < 500
  ) {
    return false;
  }

  return true;
}

function getImageCandidateUrl(imageElement) {
  const candidates = [
    imageElement.currentSrc,
    imageElement.src,
    getBestSrcsetUrl(imageElement),
    imageElement.getAttribute("src"),
    imageElement.getAttribute("data-src"),
    imageElement.getAttribute("data-url"),
    imageElement.getAttribute("data-original-src"),
    imageElement.getAttribute("data-lazy-src"),
    imageElement.getAttribute("data-nimg"),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (isRelevantImageUrl(value)) {
      return value;
    }
  }

  const parentLink = imageElement.closest("a[href]");
  const href = parentLink?.getAttribute("href") || "";
  if (isRelevantImageUrl(href) && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(href)) {
    return href;
  }

  return "";
}

function isRelevantChatImage(imageElement) {
  if (isLikelyAvatar(imageElement)) {
    return false;
  }

  if (
    imageElement.closest(
      'nav, header, aside, footer, [data-testid*="sidebar"], [class*="sidebar"]'
    ) &&
    !imageElement.closest(
      '[data-testid="assistant-message"], [data-testid="user-message"], [id^="response-"]'
    )
  ) {
    return false;
  }

  const sourceUrl = getImageCandidateUrl(imageElement);
  if (!sourceUrl) {
    return false;
  }

  const width = imageElement.naturalWidth || imageElement.width || 0;
  const height = imageElement.naturalHeight || imageElement.height || 0;
  const rect = imageElement.getBoundingClientRect();

  if (width > 0 && height > 0 && width < 8 && height < 8) {
    return false;
  }

  if (
    width < 8 &&
    height < 8 &&
    rect.width >= 48 &&
    rect.height >= 48 &&
    (sourceUrl.startsWith("blob:") ||
      sourceUrl.startsWith("data:") ||
      isLikelyGrokGeneratedImageUrl(sourceUrl))
  ) {
    return true;
  }

  return true;
}

function turnHasChatMedia(element) {
  if (!element) {
    return false;
  }

  const images = element.querySelectorAll("img, picture img");
  for (const imageElement of images) {
    if (isRelevantChatImage(imageElement)) {
      return true;
    }
  }

  const videos = element.querySelectorAll("video");
  for (const videoElement of videos) {
    if (isRelevantChatVideo(videoElement)) {
      return true;
    }
  }

  for (const selector of getAttachmentRootSelectors(window.location.hostname)) {
    const attachment = element.querySelector(selector);
    if (!attachment) {
      continue;
    }

    const label = normalizeText(attachment.innerText || attachment.textContent || "");
    if (
      attachment.querySelector("video") ||
      looksLikeVideoFilename(label) ||
      pickVideoUrl(extractUrlsFromElementTree(attachment))
    ) {
      return true;
    }
  }

  if (looksLikeVideoFilename(element.innerText || element.textContent || "")) {
    return true;
  }

  for (const selector of getAttachmentRootSelectors(window.location.hostname)) {
    const attachment = element.querySelector(selector);
    if (!attachment) {
      continue;
    }

    const label = normalizeText(attachment.innerText || attachment.textContent || "");
    if (
      looksLikeDocumentFilename(label) ||
      pickDocumentUrl(extractUrlsFromElementTree(attachment))
    ) {
      return true;
    }
  }

  if (looksLikeDocumentFilename(element.innerText || element.textContent || "")) {
    return true;
  }

  const backgroundUrl = extractBackgroundImageUrl(element);
  return Boolean(backgroundUrl && isRelevantImageUrl(backgroundUrl));
}

function findAfterMessageIndex(imageElement, messageTurns) {
  if (!imageElement || !messageTurns?.length) {
    return null;
  }

  for (const turn of messageTurns) {
    if (turn.element?.contains?.(imageElement)) {
      return turn.index;
    }
  }

  let lastPreceding = null;
  for (const turn of messageTurns) {
    if (!turn.element) {
      continue;
    }

    const position = turn.element.compareDocumentPosition(imageElement);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      lastPreceding = turn.index;
    }
  }

  return lastPreceding;
}

function getImageDiscoverySelectors(host, platformId) {
  const shared = [
    '[data-message-author-role] img',
    '[data-testid^="conversation-turn"] img',
    "article img",
    "main img",
    "picture img",
  ];

  if (host.includes("chatgpt.com")) {
    return [
      'div[data-message-author-role] img',
      'img[alt*="Generated" i]',
      'img[alt*="Image" i]',
      ...shared,
    ];
  }

  if (host.includes("gemini.google.com")) {
    return [
      ".model-response img",
      ".query-text img",
      "model-response img",
      ...shared,
    ];
  }

  if (host.includes("claude.ai")) {
    return [
      '[data-testid="assistant-message"] img',
      '[data-testid="user-message"] img',
      ".font-claude-response img",
      ...shared,
    ];
  }

  if (platformId === "grok" || platformId === "x-grok") {
    return [
      '[data-testid="assistant-message"] img',
      '[data-testid="user-message"] img',
      '[id^="response-"] img',
      ".message-bubble img",
      ".response-content-markdown img",
      'img[src*="estuary" i]',
      'img[srcset*="estuary" i]',
      'img[src*="file_" i]',
      'img[alt*="Generated" i]',
      'img[alt*="Image" i]',
      "picture img",
      ...shared,
    ];
  }

  const generic = getGenericSelectorConfig(platformId);
  if (generic?.images?.length) {
    return [...generic.images, ...shared];
  }

  return shared;
}

function findChatImages(containers, host, platformId) {
  const seenElements = new Set();
  const seenSources = new Set();
  const images = [];

  const registerImage = (imageElement) => {
    if (!imageElement || seenElements.has(imageElement)) {
      return;
    }

    seenElements.add(imageElement);

    const sourceUrl = getImageCandidateUrl(imageElement);
    if (!sourceUrl || seenSources.has(sourceUrl) || !isRelevantChatImage(imageElement)) {
      return;
    }

    seenSources.add(sourceUrl);
    images.push({ kind: "img", element: imageElement, sourceUrl });
  };

  for (const container of containers) {
    const queryImages = (selector) => {
      if (platformId === "grok" || platformId === "x-grok") {
        querySelectorAllDeep(selector, container).forEach(registerImage);
        return;
      }
      container.querySelectorAll(selector).forEach(registerImage);
    };

    queryImages("img, picture img");
  }

  for (const selector of getImageDiscoverySelectors(host, platformId)) {
    if (platformId === "grok" || platformId === "x-grok") {
      querySelectorAllDeep(selector).forEach(registerImage);
    } else {
      getScrapeRoot().querySelectorAll(selector).forEach(registerImage);
    }
  }

  if (platformId === "grok" || platformId === "x-grok") {
    querySelectorAllDeep('[data-testid="assistant-message"]').forEach((bubble) => {
      querySelectorAllDeep("img, picture img", bubble).forEach(registerImage);
    });
  }

  for (const container of containers) {
    container.querySelectorAll("figure, div, a, span").forEach((element) => {
      const backgroundUrl = extractBackgroundImageUrl(element);
      if (!backgroundUrl || seenSources.has(backgroundUrl) || !isRelevantImageUrl(backgroundUrl)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 48) {
        return;
      }

      seenSources.add(backgroundUrl);
      images.push({ kind: "background", element, sourceUrl: backgroundUrl });
    });
  }

  return sortByDocumentOrder(
    images.map((item) => item.element).filter(Boolean)
  )
    .map((element) => images.find((item) => item.element === element))
    .filter(Boolean);
}

function scrollElementIntoViewIfNeeded(element) {
  if (!element?.getBoundingClientRect) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const margin = 48;
  const inView =
    rect.top >= margin &&
    rect.bottom <= window.innerHeight - margin &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth;

  if (!inView) {
    element.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
}

function getAllChatScrollRoots(containers) {
  const roots = [];
  const starts = new Set(
    [getScrapeRoot(), document.querySelector("main"), ...safeArray(containers)].filter(Boolean)
  );

  for (const start of starts) {
    let node = start;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 16) {
        roots.push(node);
      }
      node = node.parentElement;
    }
  }

  return roots.filter(
    (element) => !roots.some((other) => other !== element && element.contains(other))
  );
}

function getPrimaryChatScrollRoot(containers) {
  return getAllChatScrollRoots(containers)[0] || null;
}

function countScrapeableRoleNodes(root = getScrapeRoot()) {
  return root.querySelectorAll(
    'div[data-message-author-role]:not([data-message-author-role] div[data-message-author-role])'
  ).length;
}

function countConversationTurns(root = getScrapeRoot()) {
  return root.querySelectorAll('[data-testid^="conversation-turn"]').length;
}

function saveChatScrollPositions(containers) {
  const scrollRoots = getAllChatScrollRoots(containers);
  const scrollTargets = scrollRoots.length ? scrollRoots : [null];
  return scrollTargets.map((root) => ({
    root,
    top: root ? root.scrollTop : window.scrollY,
  }));
}

function restoreChatScrollPositions(savedPositions) {
  for (const saved of safeArray(savedPositions)) {
    if (saved.root) {
      saved.root.scrollTop = saved.top;
    } else {
      window.scrollTo(0, saved.top);
    }
  }
}

const CHAT_SCROLL_CHECKPOINTS = [0, 0.25, 0.5, 0.75, 1];

async function visitChatScrollCheckpoints(scrollRoot, snapshot) {
  if (!scrollRoot) {
    snapshot();
    return;
  }

  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);

  for (const fraction of CHAT_SCROLL_CHECKPOINTS) {
    scrollRoot.scrollTop = Math.round(maxScroll * fraction);
    await sleep(50);
    snapshot();
  }
}

async function scrollChatToLoadLazyContent(containers) {
  const scrollRoot = getPrimaryChatScrollRoot(containers);
  const savedPositions = saveChatScrollPositions(containers);
  const stats = {
    scrollRootFound: Boolean(scrollRoot),
    turnsBefore: countConversationTurns(),
    turnsAfter: countConversationTurns(),
    roleNodesBefore: countScrapeableRoleNodes(),
    roleNodesAfter: countScrapeableRoleNodes(),
    passes: 0,
  };

  const snapshot = () => {
    stats.roleNodesAfter = countScrapeableRoleNodes();
    stats.turnsAfter = countConversationTurns();
  };

  snapshot();
  stats.passes = 1;
  await visitChatScrollCheckpoints(scrollRoot, snapshot);

  if (stats.roleNodesAfter > stats.roleNodesBefore) {
    stats.passes = 2;
    await visitChatScrollCheckpoints(scrollRoot, snapshot);
  }

  return { stats, savedPositions };
}

function getChatMessageStableKey(roleNode, fallbackIndex = 0) {
  const turn = roleNode?.closest?.('[data-testid^="conversation-turn"]');
  const turnId = turn?.getAttribute?.("data-testid") || "";
  const role = roleNode?.getAttribute?.("data-message-author-role") || "";
  if (turnId && role) {
    return `${turnId}|${role}`;
  }

  const text = normalizeText(roleNode?.innerText || roleNode?.textContent || "");
  return `${role}|${text.slice(0, 180)}|${text.length}|${fallbackIndex}`;
}

function collectChatGPTMessageEntriesFromDom() {
  const root = getScrapeRoot();
  const roleNodes = sortByDocumentOrder(
    dedupeNestedElements(
      Array.from(
        root.querySelectorAll(
          'div[data-message-author-role]:not([data-message-author-role] div[data-message-author-role])'
        )
      )
    )
  );

  return roleNodes
    .map((roleNode, index) => {
      const container = getMessageTurnContainer(roleNode);
      const message = buildMessage(
        roleNode.getAttribute("data-message-author-role"),
        roleNode.innerText,
        0,
        { allowEmpty: turnHasChatMedia(container) }
      );

      if (!message) {
        return null;
      }

      return {
        key: getChatMessageStableKey(roleNode, index),
        element: container,
        message,
      };
    })
    .filter(Boolean);
}

function parseChatEntryTurnIndex(key) {
  const turnId = String(key || "").split("|")[0] || "";
  const match =
    turnId.match(/conversation-turn-(\d+)/i) ||
    turnId.match(/(?:^|-)turn-(\d+)/i) ||
    turnId.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseChatEntryRoleRank(key, messageRole) {
  const roleFromKey = String(key || "").split("|")[1] || "";
  const role = normalizeRoleAttr(messageRole || roleFromKey);
  if (role === "user") {
    return 0;
  }
  if (role === "assistant") {
    return 1;
  }
  return 2;
}

function sortChatGPTEntriesByConversationOrder(entries) {
  const connectedRank = new Map();
  sortByDocumentOrder(
    entries.map((entry) => entry?.element).filter((element) => element?.isConnected)
  ).forEach((element, index) => {
    connectedRank.set(element, index);
  });

  return [...entries].sort((left, right) => {
    const leftTurn = parseChatEntryTurnIndex(left.key);
    const rightTurn = parseChatEntryTurnIndex(right.key);

    if (leftTurn != null && rightTurn != null && leftTurn !== rightTurn) {
      return leftTurn - rightTurn;
    }

    if (leftTurn != null && rightTurn != null) {
      const roleDelta =
        parseChatEntryRoleRank(left.key, left.message?.role) -
        parseChatEntryRoleRank(right.key, right.message?.role);
      if (roleDelta !== 0) {
        return roleDelta;
      }
    }

    const leftDoc = connectedRank.get(left.element);
    const rightDoc = connectedRank.get(right.element);
    if (leftDoc != null && rightDoc != null && leftDoc !== rightDoc) {
      return leftDoc - rightDoc;
    }

    return String(left.key || "").localeCompare(String(right.key || ""));
  });
}

function ingestChatGPTEntries(entries, entriesByKey, entryOrder) {
  for (const entry of safeArray(entries)) {
    if (!entry?.key) {
      continue;
    }

    if (entriesByKey.has(entry.key)) {
      entriesByKey.get(entry.key).element = entry.element;
      continue;
    }

    entriesByKey.set(entry.key, entry);
    entryOrder.push(entry.key);
  }
}

async function accumulateChatGPTConversation(containers) {
  const entriesByKey = new Map();
  const entryOrder = [];
  const scrollRoot = getPrimaryChatScrollRoot(containers);
  const savedPositions = saveChatScrollPositions(containers);
  const stats = {
    scrollRootFound: Boolean(scrollRoot),
    turnsBefore: countConversationTurns(),
    turnsAfter: countConversationTurns(),
    roleNodesBefore: countScrapeableRoleNodes(),
    roleNodesAfter: countScrapeableRoleNodes(),
    passes: 0,
    messagesAccumulated: 0,
  };

  const snapshot = () => {
    ingestChatGPTEntries(collectChatGPTMessageEntriesFromDom(), entriesByKey, entryOrder);
    stats.messagesAccumulated = entryOrder.length;
    stats.roleNodesAfter = countScrapeableRoleNodes();
    stats.turnsAfter = countConversationTurns();
  };

  snapshot();
  const beforeScroll = entryOrder.length;
  stats.passes = 1;
  await visitChatScrollCheckpoints(scrollRoot, snapshot);

  if (entryOrder.length > beforeScroll) {
    stats.passes = 2;
    await visitChatScrollCheckpoints(scrollRoot, snapshot);
  }

  ingestChatGPTEntries(collectChatGPTMessageEntriesFromDom(), entriesByKey, entryOrder);
  stats.messagesAccumulated = entryOrder.length;

  const sortedEntries = sortChatGPTEntriesByConversationOrder(
    entryOrder.map((key) => entriesByKey.get(key)).filter(Boolean)
  );

  return {
    ...buildConversationFromTurnEntries(sortedEntries),
    scrollStats: stats,
    savedPositions,
  };
}

function countLikelyTurns(root = getScrapeRoot()) {
  return root.querySelectorAll(
    'div[data-message-author-role]:not([data-message-author-role] div[data-message-author-role]), [data-testid="user-message"], [data-testid="assistant-message"], .query-text, .model-response-text'
  ).length;
}

async function waitForPlatformImagesToLoad(platformId) {
  if (platformId !== "grok" && platformId !== "x-grok") {
    return;
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidates = querySelectorAllDeep(
      '[data-testid="assistant-message"] img, [id^="response-"] img, .message-bubble img'
    ).filter((imageElement) => isRelevantChatImage(imageElement));

    if (candidates.length === 0) {
      await sleep(250);
      continue;
    }

    const hasDrawableImage = candidates.some(
      (imageElement) => imageElement.complete && imageElement.naturalWidth > 0
    );

    if (hasDrawableImage || attempt >= 8) {
      return;
    }

    await sleep(250);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsBase64FromPageContext(imgUrl) {
  const response = await fetch(imgUrl, {
    credentials: "include",
    cache: "force-cache",
  });

  if (!response.ok) {
    throw new Error(`Page fetch failed with status ${response.status}`);
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function wakeBackgroundWorker() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "PING" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function fetchImageAsBase64FromBackground(imgUrl) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "FETCH_IMAGE_AS_BASE64", url: imgUrl },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || response.status !== "SUCCESS") {
          reject(new Error(response?.message || "Background image fetch failed."));
          return;
        }

        resolve(response.base64);
      }
    );
  });
}

function waitForImageReady(imageElement, timeoutMs = 4000) {
  if (imageElement.complete && imageElement.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Image load timed out."));
    }, timeoutMs);

    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Image failed to load."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      imageElement.removeEventListener("load", onLoad);
      imageElement.removeEventListener("error", onError);
    };

    imageElement.addEventListener("load", onLoad, { once: true });
    imageElement.addEventListener("error", onError, { once: true });
  });
}

async function captureImageViaCanvas(imageElement, timeoutMs = 4000) {
  scrollElementIntoViewIfNeeded(imageElement);
  await waitForImageReady(imageElement, timeoutMs);

  const width = imageElement.naturalWidth || imageElement.width;
  const height = imageElement.naturalHeight || imageElement.height;

  if (!width || !height) {
    throw new Error("Image has no drawable dimensions.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  context.drawImage(imageElement, 0, 0);
  return canvas.toDataURL("image/png");
}

async function captureUrlOnlyBase64(imgUrl) {
  const url = String(imgUrl || "");
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    throw new Error("Inline URL requires a rendered image element.");
  }

  await wakeBackgroundWorker();
  const base64 = await fetchImageAsBase64FromBackground(url);
  return { base64, captureMethod: "background-fetch-url" };
}

async function captureImageBase64(imageElement, imgUrl, kind, platformId = null) {
  const url = String(imgUrl || "");
  if (!url) {
    throw new Error("Missing image URL.");
  }

  if (kind === "background") {
    return captureUrlOnlyBase64(url);
  }

  const isInlineSource =
    url.startsWith("blob:") || url.startsWith("data:");

  const preferPageCapture =
    platformId === "grok" ||
    platformId === "x-grok" ||
    isInlineSource ||
    imageRequiresPageCredentials(url);

  if (preferPageCapture) {
    if (isInlineSource || imageElement) {
      try {
        const base64 = await captureImageViaCanvas(
          imageElement,
          platformId === "grok" || platformId === "x-grok" ? 10000 : 4000
        );
        return { base64, captureMethod: "canvas-primary" };
      } catch (_canvasError) {
        // Fall through to page fetch / background fetch.
      }
    }

    if (!isInlineSource) {
      try {
        const base64 = await fetchImageAsBase64FromPageContext(url);
        return { base64, captureMethod: "page-fetch" };
      } catch (_pageFetchError) {
        // Fall through to background fetch.
      }
    }
  }

  if (isInlineSource) {
    const base64 = await captureImageViaCanvas(imageElement);
    return { base64, captureMethod: "canvas-inline" };
  }

  try {
    await wakeBackgroundWorker();
    const base64 = await fetchImageAsBase64FromBackground(url);
    return { base64, captureMethod: "background-fetch" };
  } catch (backgroundError) {
    try {
      const base64 = await fetchImageAsBase64FromPageContext(url);
      return { base64, captureMethod: "page-fetch-fallback" };
    } catch (_pageFetchError) {
      try {
        const base64 = await captureImageViaCanvas(imageElement);
        return { base64, captureMethod: "canvas-fallback" };
      } catch (canvasError) {
        throw new Error(backgroundError.message || canvasError.message);
      }
    }
  }
}

const VIDEO_FILE_PATTERN = /\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg)(\?|#|$)/i;

function looksLikeVideoFilename(text) {
  return VIDEO_FILE_PATTERN.test(String(text || ""));
}

function extractFilenameFromText(text) {
  return extractAllVideoFilenames(text)[0] || "";
}

function extractAllVideoFilenames(text) {
  const seen = new Set();
  const results = [];
  const add = (name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    results.push(trimmed);
  };

  const source = String(text || "");
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const linePattern = /^(.+\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg))$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineMatch = line.match(linePattern);
    if (lineMatch) {
      add(lineMatch[1]);
      continue;
    }

    const nextLine = lines[index + 1] || "";
    if (/^(File|Video)$/i.test(nextLine) && linePattern.test(line)) {
      add(line);
    }
  }

  const inlinePattern = /[^\s/\\'"<>]+\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg)/gi;
  let match = inlinePattern.exec(source);
  while (match) {
    add(match[0]);
    match = inlinePattern.exec(source);
  }

  return results;
}

const DOCUMENT_FILE_PATTERN =
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|json|md|markdown|rtf|odt|ods|zip|html?|xml|yaml|yml|wav|wave|mp3|m4a|ogg|flac|aac|weba|aiff?|mid|midi)(\?|#|$)/i;

function extractDocumentFilenameFromText(text) {
  return extractAllDocumentFilenames(text)[0] || "";
}

function looksLikeDocumentFilename(text) {
  return DOCUMENT_FILE_PATTERN.test(String(text || ""));
}

function guessMimeTypeFromFilename(filename) {
  const ext = String(filename || "").split(".").pop()?.toLowerCase() || "";
  const map = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    md: "text/markdown",
    markdown: "text/markdown",
    rtf: "application/rtf",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    zip: "application/zip",
    htm: "text/html",
    html: "text/html",
    xml: "application/xml",
    yaml: "text/yaml",
    yml: "text/yaml",
    wav: "audio/wav",
    wave: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    weba: "audio/webm",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    mid: "audio/midi",
    midi: "audio/midi",
  };
  return map[ext] || "application/octet-stream";
}

function pickDocumentUrl(urls) {
  for (const url of urls) {
    if (url.startsWith("data:video/")) {
      continue;
    }
    if (
      url.startsWith("data:application/") ||
      url.startsWith("data:text/") ||
      url.startsWith("data:audio/") ||
      url.startsWith("data:application/octet-stream")
    ) {
      return url;
    }
    if (DOCUMENT_FILE_PATTERN.test(url)) {
      return url;
    }
  }

  for (const url of urls) {
    if (url.startsWith("blob:")) {
      return url;
    }
  }

  return "";
}

function isLikelyDocumentLink(node) {
  const href =
    node.getAttribute?.("href") ||
    node.getAttribute?.("data") ||
    node.getAttribute?.("src") ||
    "";
  const type = String(node.getAttribute?.("type") || "").toLowerCase();
  const label = normalizeText(node.innerText || node.textContent || "");

  return (
    DOCUMENT_FILE_PATTERN.test(href) ||
    type.includes("pdf") ||
    type.startsWith("text/") ||
    type.includes("document") ||
    type.includes("spreadsheet") ||
    looksLikeDocumentFilename(label)
  );
}

function extractUrlsFromElementTree(element) {
  const urls = new Set();
  const URL_ATTRS = [
    "href",
    "src",
    "data-src",
    "data-url",
    "data-file-url",
    "data-download-url",
    "data-href",
    "content",
  ];

  const visit = (node) => {
    if (!node) {
      return;
    }

    if (node.getAttribute) {
      for (const attr of URL_ATTRS) {
        const value = String(node.getAttribute(attr) || "").trim();
        if (value && !value.startsWith("#")) {
          urls.add(value);
        }
      }
    }

    if (node.src && typeof node.src === "string") {
      urls.add(node.src);
    }
    if (node.href && typeof node.href === "string") {
      urls.add(node.href);
    }

    if (node.querySelectorAll) {
      node.querySelectorAll("*").forEach(visit);
    }
  };

  visit(element);
  return [...urls];
}

function pickVideoUrl(urls) {
  for (const url of urls) {
    if (url.startsWith("blob:") || url.startsWith("data:video/")) {
      return url;
    }
    if (VIDEO_FILE_PATTERN.test(url)) {
      return url;
    }
  }

  return urls.find((url) => url.startsWith("blob:")) || "";
}

function isInsideMessageTurn(element) {
  return Boolean(
    element?.closest?.(
      '[data-message-author-role], [data-testid^="conversation-turn"], [data-testid="user-message"], [data-testid="assistant-message"], .query-text, .model-response-text, .user-query, .model-response, user-query, model-response, ms-chat-turn, .chat-turn-container, [class*="chat-turn"]'
    )
  );
}

function getAttachmentRootSelectors(host) {
  const shared = [
    '[data-testid*="attachment"]',
    '[data-testid*="file"]',
    '[data-testid*="upload"]',
    '[data-testid*="chip"]',
    '[data-testid*="thumbnail"]',
    '[class*="attachment"]',
    '[class*="file-preview"]',
    '[class*="file-card"]',
    '[class*="file-chip"]',
    '[class*="file-name"]',
    "ms-file-chip",
  ];

  if (host.includes("chatgpt.com")) {
    return [
      '[data-testid*="attachment"]',
      '[data-testid*="file"]',
      '[data-testid*="chip"]',
      '[class*="file"]',
      ...shared,
    ];
  }

  if (host.includes("gemini.google.com")) {
    return [
      "ms-file-chip",
      '[class*="file-chip"]',
      '[class*="upload-card"]',
      '[class*="attachment"]',
      ...shared,
    ];
  }

  return shared;
}

function findTurnElementForMessage(message, messageTurns) {
  const messageIndex = Number(message?.index);
  if (Number.isFinite(messageIndex)) {
    const matchedTurn = safeArray(messageTurns).find((turn) => turn.index === messageIndex);
    if (matchedTurn?.element) {
      return matchedTurn.element;
    }
  }

  return getScrapeRoot();
}

function registerAttachmentFilenamesFromConversation(
  conversation,
  messageTurns,
  register,
  extractFilenames,
  kind,
  options = {}
) {
  const roles = new Set(safeArray(options.roles?.length ? options.roles : ["user"]));

  for (const message of safeArray(conversation)) {
    if (!roles.has(message?.role)) {
      continue;
    }

    const element = findTurnElementForMessage(message, messageTurns);
    for (const filename of extractFilenames(message.text || "")) {
      register(element, {
        kind,
        filename,
        label: filename,
      });
    }
  }
}

function findAttachmentVideoTargets(messageTurns, host, conversation = []) {
  const targets = [];
  const seen = new Set();

  const register = (element, meta = {}) => {
    if (!element) {
      return;
    }

    const filename =
      meta.filename ||
      extractFilenameFromText(meta.label) ||
      extractFilenameFromText(element.innerText || "");
    const label = meta.label || filename || "";
    const dedupeKey = `${meta.kind || "attachment"}|${filename || label}|${element}`;

    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    targets.push({
      element,
      kind: meta.kind || "attachment",
      sourceUrl: meta.sourceUrl || "",
      filename,
      label,
    });
  };

  const inspectScope = (scope) => {
    if (!scope) {
      return;
    }

    scope.querySelectorAll("video").forEach((videoElement) => {
      if (!isRelevantChatVideo(videoElement)) {
        return;
      }
      register(videoElement, {
        kind: "video",
        sourceUrl: getVideoCandidateUrl(videoElement),
        label: normalizeText(videoElement.getAttribute("aria-label") || ""),
      });
    });

    for (const selector of getAttachmentRootSelectors(host)) {
      scope.querySelectorAll(selector).forEach((attachmentRoot) => {
        if (!isInsideMessageTurn(attachmentRoot)) {
          return;
        }

        const label = normalizeText(attachmentRoot.innerText || attachmentRoot.textContent || "");
        const filename =
          extractFilenameFromText(label) ||
          extractFilenameFromText(attachmentRoot.getAttribute("aria-label") || "");
        const urls = extractUrlsFromElementTree(attachmentRoot);
        const videoUrl = pickVideoUrl(urls);
        const nestedVideo = attachmentRoot.querySelector("video");

        if (
          nestedVideo ||
          videoUrl ||
          looksLikeVideoFilename(label) ||
          looksLikeVideoFilename(filename)
        ) {
          if (looksLikeDocumentFilename(label) || looksLikeDocumentFilename(filename)) {
            return;
          }
          register(attachmentRoot, {
            kind: nestedVideo ? "video" : "attachment",
            sourceUrl: videoUrl || (nestedVideo ? getVideoCandidateUrl(nestedVideo) : ""),
            filename,
            label,
          });
        }
      });
    }

    scope.querySelectorAll('a[href], object, embed').forEach((node) => {
      const href =
        node.getAttribute("href") ||
        node.getAttribute("data") ||
        node.getAttribute("src") ||
        "";
      const type = String(node.getAttribute("type") || "").toLowerCase();
      const label = normalizeText(node.innerText || node.textContent || "");

      if (
        VIDEO_FILE_PATTERN.test(href) ||
        type.startsWith("video/") ||
        looksLikeVideoFilename(label)
      ) {
        register(node, {
          kind: "attachment-link",
          sourceUrl: href,
          filename: extractFilenameFromText(label) || extractFilenameFromText(href),
          label,
        });
      }
    });
  };

  for (const turn of safeArray(messageTurns)) {
    inspectScope(turn.element);

    const turnText = normalizeText(turn.element?.innerText || turn.element?.textContent || "");
    for (const filename of extractAllVideoFilenames(turnText)) {
      register(turn.element, {
        kind: "video-text-mention",
        filename,
        label: filename,
      });
    }
  }

  registerAttachmentFilenamesFromConversation(
    conversation,
    messageTurns,
    register,
    extractAllVideoFilenames,
    "video-conversation-text"
  );

  inspectScope(getScrapeRoot());

  return sortByDocumentOrder(targets.map((target) => target.element))
    .map((element) => targets.find((target) => target.element === element))
    .filter(Boolean);
}

function getVideoCandidateUrl(videoElement) {
  const candidates = [
    videoElement.currentSrc,
    videoElement.src,
    videoElement.querySelector("source")?.getAttribute("src"),
    videoElement.getAttribute("data-src"),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value && !value.startsWith("chrome-extension://")) {
      return value;
    }
  }

  return "";
}

function isRelevantChatVideo(videoElement) {
  if (!videoElement || videoElement.closest("nav, header, aside, footer")) {
    return false;
  }

  if (
    !videoElement.closest(
      '[data-message-author-role], [data-testid^="conversation-turn"], [data-testid="user-message"], [data-testid="assistant-message"], .query-text, .model-response-text, .user-query, .model-response, user-query, model-response, main'
    )
  ) {
    return false;
  }

  const rect = videoElement.getBoundingClientRect();
  if (rect.width > 0 && rect.width < 32 && rect.height > 0 && rect.height < 32) {
    return false;
  }

  const sourceUrl = getVideoCandidateUrl(videoElement);
  return Boolean(sourceUrl) || videoElement.readyState > 0;
}

function getVideoDiscoverySelectors(host, platformId) {
  const shared = [
    '[data-message-author-role] video',
    '[data-testid^="conversation-turn"] video',
    "article video",
    "main video",
  ];

  if (host.includes("chatgpt.com") || host.includes("gemini.google.com")) {
    return [
      '[data-message-author-role="user"] video',
      '[data-message-author-role="assistant"] video',
      '[data-message-author-role="model"] video',
      ".query-text video",
      ".model-response-text video",
      ...shared,
    ];
  }

  if (platformId === "grok" || platformId === "x-grok") {
    return [
      '[data-testid="assistant-message"] video',
      '[data-testid="user-message"] video',
      ...shared,
    ];
  }

  return shared;
}

function findChatVideos(containers, host, platformId, messageTurns = [], conversation = []) {
  const seenKeys = new Set();
  const videos = [];

  const registerTarget = (target) => {
    if (!target?.element) {
      return;
    }

    const sourceUrl = String(target.sourceUrl || "").trim();
    const filename = String(target.filename || "").trim();
    const label = String(target.label || "").trim();
    const dedupeKey = (
      filename ||
      sourceUrl ||
      label ||
      `${target.kind || "video"}|${target.element}`
    ).toLowerCase();

    if (seenKeys.has(dedupeKey)) {
      return;
    }

    seenKeys.add(dedupeKey);
    videos.push({
      ...target,
      filename,
      label: label || filename,
    });
  };

  const registerVideoElement = (videoElement) => {
    if (!videoElement || !isRelevantChatVideo(videoElement)) {
      return;
    }

    registerTarget({
      element: videoElement,
      kind: "video",
      sourceUrl: getVideoCandidateUrl(videoElement),
    });
  };

  for (const container of containers) {
    container.querySelectorAll("video").forEach(registerVideoElement);
  }

  for (const selector of getVideoDiscoverySelectors(host, platformId)) {
    getScrapeRoot().querySelectorAll(selector).forEach(registerVideoElement);
  }

  for (const attachmentTarget of findAttachmentVideoTargets(messageTurns, host, conversation)) {
    registerTarget(attachmentTarget);
  }

  return sortByDocumentOrder(videos.map((item) => item.element)).flatMap((element) =>
    videos.filter((item) => item.element === element)
  );
}

function waitForVideoReady(videoElement, timeoutMs = 8000) {
  if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      if (videoElement.videoWidth > 0 || videoElement.readyState >= 1) {
        resolve();
        return;
      }
      reject(new Error("Video load timed out."));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video failed to load."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      videoElement.removeEventListener("loadeddata", onReady);
      videoElement.removeEventListener("canplay", onReady);
      videoElement.removeEventListener("error", onError);
    };

    videoElement.addEventListener("loadeddata", onReady, { once: true });
    videoElement.addEventListener("canplay", onReady, { once: true });
    videoElement.addEventListener("error", onError, { once: true });

    if (videoElement.paused) {
      videoElement.play().catch(() => {});
    }
  });
}

async function captureVideoBase64(videoElement, videoUrl) {
  const url = String(videoUrl || getVideoCandidateUrl(videoElement) || "");

  if (videoElement) {
    scrollElementIntoViewIfNeeded(videoElement);
    await waitForVideoReady(videoElement);
  }

  if (url.startsWith("blob:") || url.startsWith("data:")) {
    const response = await fetch(url);
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    return {
      base64: dataUrl,
      mimeType: blob.type || "video/mp4",
      captureMethod: "blob-fetch",
    };
  }

  if (url) {
    try {
      const dataUrl = await fetchImageAsBase64FromPageContext(url);
      const mimeMatch = dataUrl.match(/^data:([^;]+);/);
      return {
        base64: dataUrl,
        mimeType: mimeMatch?.[1] || "video/mp4",
        captureMethod: "page-fetch",
      };
    } catch (_pageFetchError) {
      // Fall through to canvas poster capture when a video element exists.
    }
  }

  if (!videoElement) {
    throw new Error("No retrievable video URL in page DOM.");
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth || videoElement.clientWidth || 640;
    canvas.height = videoElement.videoHeight || videoElement.clientHeight || 360;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context unavailable.");
    }
    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return {
      base64: canvas.toDataURL("image/png"),
      mimeType: "image/png",
      captureMethod: "video-poster-frame",
    };
  } catch (canvasError) {
    throw new Error(canvasError.message || "Video capture failed.");
  }
}

async function captureChatVideoTarget(target, platformId = null) {
  const element = target?.element;
  if (!element) {
    throw new Error("Missing attachment element.");
  }

  scrollElementIntoViewIfNeeded(element);
  await sleep(150);

  const nestedVideo =
    element.tagName === "VIDEO" ? element : element.querySelector("video");
  const discoveredUrl =
    target.sourceUrl || pickVideoUrl(extractUrlsFromElementTree(element)) || "";
  const isTextMention =
    target.kind === "video-text-mention" || target.kind === "video-conversation-text";

  if (isTextMention && !discoveredUrl && !nestedVideo) {
    throw new Error(
      "Video attachment is visible in chat but ChatGPT/Gemini do not expose a downloadable copy in the page DOM."
    );
  }

  if (nestedVideo) {
    return captureVideoBase64(
      nestedVideo,
      target.sourceUrl || getVideoCandidateUrl(nestedVideo)
    );
  }

  if (discoveredUrl) {
    return captureVideoBase64(null, discoveredUrl);
  }

  const posterImage = element.querySelector("img");
  if (posterImage && isRelevantChatImage(posterImage)) {
    const imgUrl = getImageCandidateUrl(posterImage);
    const captureResult = await captureImageBase64(
      posterImage,
      imgUrl,
      "img",
      platformId
    );
    return {
      base64: captureResult.base64,
      mimeType: "image/png",
      captureMethod: "attachment-poster-image",
    };
  }

  throw new Error(
    "Video attachment is visible in chat but ChatGPT/Gemini do not expose a downloadable copy in the page DOM."
  );
}

async function captureSessionVideos(
  host,
  messageTurns = [],
  platformId = null,
  conversation = []
) {
  const containers = getChatContainers(host, platformId);
  const videoTargets = safeArray(
    findChatVideos(containers, host, platformId, messageTurns, conversation)
  );
  const sessionVideos = [];

  for (let index = 0; index < videoTargets.length; index += 1) {
    const target = videoTargets[index];
    const element = target.element;
    const nestedVideo =
      element?.tagName === "VIDEO" ? element : element?.querySelector?.("video");
    const videoUrl = String(
      target.sourceUrl ||
        getVideoCandidateUrl(nestedVideo) ||
        pickVideoUrl(extractUrlsFromElementTree(element)) ||
        ""
    );
    const afterMessageIndex = findAfterMessageIndex(element, messageTurns);

    const videoRecord = {
      index: index + 1,
      documentOrder: index + 1,
      afterMessageIndex,
      sourceUrl: videoUrl,
      filename: target.filename || extractFilenameFromText(target.label) || "",
      label: target.label || target.filename || "",
      mimeType: "video/mp4",
      width: nestedVideo?.videoWidth || element?.clientWidth || 0,
      height: nestedVideo?.videoHeight || element?.clientHeight || 0,
      duration:
        nestedVideo && Number.isFinite(nestedVideo.duration)
          ? nestedVideo.duration
          : null,
      base64: null,
      captureStatus: "pending",
      captureKind: target.kind || "video",
    };

    try {
      const captureResult = await captureChatVideoTarget(target, platformId);
      const posterOnly =
        captureResult.captureMethod === "video-poster-frame" ||
        captureResult.captureMethod === "attachment-poster-image";
      const namedAttachment = Boolean(videoRecord.filename || videoRecord.label);

      if (posterOnly && namedAttachment) {
        videoRecord.captureStatus = "metadata-only";
        videoRecord.captureMethod = captureResult.captureMethod;
        videoRecord.error =
          "Video attachment is visible in chat but ChatGPT/Gemini do not expose a downloadable copy in the page DOM.";
      } else {
        videoRecord.base64 = captureResult.base64;
        videoRecord.mimeType = captureResult.mimeType || videoRecord.mimeType;
        videoRecord.captureMethod = captureResult.captureMethod;
        videoRecord.captureStatus = "success";
      }
    } catch (error) {
      if (videoRecord.filename || videoRecord.label) {
        videoRecord.captureStatus = "metadata-only";
        videoRecord.error = error.message;
      } else {
        videoRecord.captureStatus = "failed";
        videoRecord.error = error.message;
      }
    }

    sessionVideos.push(videoRecord);
  }

  return sessionVideos;
}

function findAttachmentDocumentTargets(messageTurns, host, conversation = []) {
  const targets = [];
  const seen = new Set();

  const register = (element, meta = {}) => {
    if (!element) {
      return;
    }

    const filename =
      meta.filename ||
      extractDocumentFilenameFromText(meta.label) ||
      extractDocumentFilenameFromText(element.innerText || "");
    const label = meta.label || filename || normalizeText(element.innerText || "");
    const afterMessageIndex = findAfterMessageIndex(element, messageTurns);
    const normalizedFilename = normalizeAttachmentFilename(filename || label);

    for (const existing of targets) {
      if (existing.afterMessageIndex !== afterMessageIndex) {
        continue;
      }

      if (
        documentFilenamesOverlap(
          existing.filename || existing.label,
          filename || label
        )
      ) {
        const existingName = String(existing.filename || existing.label || "");
        const nextName = String(filename || label || "");
        if (nextName.length > existingName.length) {
          existing.filename = filename || nextName;
          existing.label = label || nextName;
        }
        return;
      }
    }

    const dedupeKey =
      normalizedFilename && Number.isFinite(afterMessageIndex) && afterMessageIndex > 0
        ? `${afterMessageIndex}|${normalizedFilename}`
        : `${String(meta.kind || "document")}|${normalizedFilename || label}|${element}`;

    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    targets.push({
      element,
      kind: meta.kind || "document",
      sourceUrl: meta.sourceUrl || "",
      filename,
      label,
      mimeType: meta.mimeType || guessMimeTypeFromFilename(filename || label),
      afterMessageIndex,
    });
  };

  const inspectScope = (scope, options = {}) => {
    if (!scope) {
      return;
    }

    const restrictToScope = options.restrictToScope === true;

    for (const selector of getAttachmentRootSelectors(host)) {
      queryNodesInScope(scope, selector).forEach((attachmentRoot) => {
        if (restrictToScope && !scope.contains(attachmentRoot)) {
          return;
        }

        if (!restrictToScope && !isInsideMessageTurn(attachmentRoot)) {
          return;
        }

        const label = normalizeText(attachmentRoot.innerText || attachmentRoot.textContent || "");
        const ariaLabel = normalizeText(attachmentRoot.getAttribute("aria-label") || "");
        const filename =
          extractDocumentFilenameFromText(label) ||
          extractDocumentFilenameFromText(ariaLabel) ||
          extractDocumentFilenameFromText(attachmentRoot.getAttribute("title") || "");
        const urls = extractUrlsFromElementTree(attachmentRoot);
        const documentUrl = pickDocumentUrl(urls);
        const isVideoLike =
          attachmentRoot.querySelector("video") ||
          looksLikeVideoFilename(label) ||
          looksLikeVideoFilename(filename);

        if (isVideoLike) {
          return;
        }

        if (
          documentUrl ||
          filename ||
          looksLikeDocumentFilename(label) ||
          looksLikeDocumentFilename(ariaLabel) ||
          looksLikeAttachmentChip(attachmentRoot)
        ) {
          register(attachmentRoot, {
            kind: "document",
            sourceUrl: documentUrl,
            filename,
            label: label || ariaLabel || filename,
          });
        }
      });
    }

    if (restrictToScope) {
      scanUserTurnFileArtifacts(scope, register);
    }

    queryNodesInScope(scope, "[aria-label], [title]").forEach((node) => {
      const ariaLabel = String(node.getAttribute("aria-label") || node.getAttribute("title") || "");
      const filename = extractDocumentFilenameFromText(ariaLabel);
      if (!filename) {
        return;
      }

      if (restrictToScope && !scope.contains(node)) {
        return;
      }

      if (!restrictToScope && !isInsideMessageTurn(node)) {
        return;
      }

      register(node, {
        kind: "document-aria-label",
        filename,
        label: ariaLabel,
      });
    });

    scope.querySelectorAll('a[href], object, embed').forEach((node) => {
      if (!isLikelyDocumentLink(node)) {
        return;
      }

      if (restrictToScope && !scope.contains(node)) {
        return;
      }

      if (!restrictToScope && !isInsideMessageTurn(node)) {
        return;
      }

      const href =
        node.getAttribute("href") ||
        node.getAttribute("data") ||
        node.getAttribute("src") ||
        "";
      const label = normalizeText(node.innerText || node.textContent || "");
      const filename =
        extractDocumentFilenameFromText(label) ||
        extractDocumentFilenameFromText(href) ||
        extractDocumentFilenameFromText(node.getAttribute("download") || "");

      register(node, {
        kind: "document-link",
        sourceUrl: href,
        filename,
        label: label || filename,
      });
    });

    scope.querySelectorAll('[data-testid*="download"], [download]').forEach((node) => {
      if (restrictToScope && !scope.contains(node)) {
        return;
      }

      if (!restrictToScope && !isInsideMessageTurn(node)) {
        return;
      }

      const href = node.getAttribute("href") || node.getAttribute("data-url") || "";
      const label = normalizeText(
        node.innerText || node.textContent || node.getAttribute("aria-label") || ""
      );
      const filename =
        extractDocumentFilenameFromText(label) ||
        extractDocumentFilenameFromText(href) ||
        extractDocumentFilenameFromText(node.getAttribute("download") || "");

      if (!filename && !DOCUMENT_FILE_PATTERN.test(href)) {
        return;
      }

      register(node, {
        kind: "document-download",
        sourceUrl: href,
        filename,
        label: label || filename,
      });
    });
  };

  for (const turn of safeArray(messageTurns)) {
    if (turn.role !== "user") {
      continue;
    }

    const container = turn.element;
    inspectScope(container, { restrictToScope: true });

    const turnText = normalizeText(container?.innerText || container?.textContent || "");
    for (const filename of extractUserFileAttachmentFilenames(turnText)) {
      register(container, {
        kind: "document-text-mention",
        filename,
        label: filename,
      });
    }
  }

  registerAttachmentFilenamesFromConversation(
    conversation,
    messageTurns,
    register,
    extractUserFileAttachmentFilenames,
    "document-conversation-text",
    { roles: ["user"] }
  );

  registerAttachmentFilenamesFromConversation(
    conversation,
    messageTurns,
    register,
    extractInferredGeneratedFilenames,
    "document-assistant-generated",
    { roles: ["assistant"] }
  );

  return sortByDocumentOrder(targets.map((target) => target.element))
    .map((element) => targets.find((target) => target.element === element))
    .filter(Boolean);
}

async function captureBinaryFromUrl(url, fallbackMimeType = "application/octet-stream") {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    throw new Error("Missing document URL.");
  }

  if (normalizedUrl.startsWith("blob:") || normalizedUrl.startsWith("data:")) {
    const response = await fetch(normalizedUrl);
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    return {
      base64: dataUrl,
      mimeType: blob.type || fallbackMimeType,
      captureMethod: "blob-fetch",
    };
  }

  const dataUrl = await fetchImageAsBase64FromPageContext(normalizedUrl);
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  return {
    base64: dataUrl,
    mimeType: mimeMatch?.[1] || fallbackMimeType,
    captureMethod: "page-fetch",
  };
}

async function captureChatDocumentTarget(target) {
  const element = target?.element;
  if (!element) {
    throw new Error("Missing attachment element.");
  }

  scrollElementIntoViewIfNeeded(element);
  await sleep(150);

  const filename =
    target.filename ||
    extractDocumentFilenameFromText(target.label) ||
    extractDocumentFilenameFromText(element.innerText || "");
  const fallbackMime = target.mimeType || guessMimeTypeFromFilename(filename);
  const discoveredUrl =
    target.sourceUrl || pickDocumentUrl(extractUrlsFromElementTree(element));

  if (discoveredUrl) {
    return captureBinaryFromUrl(discoveredUrl, fallbackMime);
  }

  throw new Error(
    "Document attachment is visible in chat but ChatGPT/Gemini do not expose a downloadable copy in the page DOM."
  );
}

async function captureSessionDocuments(
  host,
  messageTurns = [],
  platformId = null,
  documentTargets = null
) {
  const targets = safeArray(
    documentTargets ?? findAttachmentDocumentTargets(messageTurns, host)
  );
  const sessionDocuments = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const element = target.element;
    const filename =
      target.filename ||
      extractDocumentFilenameFromText(target.label) ||
      extractDocumentFilenameFromText(element?.innerText || "") ||
      "";
    const sourceUrl = String(
      target.sourceUrl || pickDocumentUrl(extractUrlsFromElementTree(element)) || ""
    );
    const afterMessageIndex = findAfterMessageIndex(element, messageTurns);

    const documentRecord = {
      index: index + 1,
      documentOrder: index + 1,
      afterMessageIndex,
      sourceUrl,
      filename: filename || extractDocumentFilenameFromText(target.label) || "",
      label: target.label || filename || "Document attachment",
      mimeType: target.mimeType || guessMimeTypeFromFilename(filename || target.label),
      base64: null,
      captureStatus: "pending",
      captureKind: target.kind || "document",
    };

    try {
      const captureResult = await captureChatDocumentTarget(target);
      documentRecord.base64 = captureResult.base64;
      documentRecord.mimeType = captureResult.mimeType || documentRecord.mimeType;
      documentRecord.captureMethod = captureResult.captureMethod;
      documentRecord.captureStatus = "success";
    } catch (error) {
      if (documentRecord.filename || documentRecord.label) {
        documentRecord.captureStatus = "metadata-only";
        documentRecord.error = error.message;
      } else {
        documentRecord.captureStatus = "failed";
        documentRecord.error = error.message;
      }
    }

    if (
      documentRecord.captureStatus === "metadata-only" &&
      !documentRecord.filename &&
      documentRecord.label
    ) {
      documentRecord.filename = extractDocumentFilenameFromText(documentRecord.label) || documentRecord.label;
    }

    sessionDocuments.push(documentRecord);
  }

  return sessionDocuments;
}

async function captureSessionImages(host, messageTurns = [], platformId = null) {
  const containers = getChatContainers(host, platformId);
  await waitForPlatformImagesToLoad(platformId);

  const imageTargets = safeArray(findChatImages(containers, host, platformId));
  const sessionImages = [];

  for (let index = 0; index < imageTargets.length; index += 1) {
    const target = imageTargets[index];
    if (!target?.sourceUrl || !target?.element) {
      continue;
    }

    const imageElement = target.element;
    const imgUrl = String(target.sourceUrl);
    const afterMessageIndex = findAfterMessageIndex(imageElement, messageTurns);

    const imageRecord = {
      index: index + 1,
      documentOrder: index + 1,
      afterMessageIndex,
      sourceUrl: imgUrl,
      alt:
        target.kind === "img"
          ? String(imageElement.alt || "")
          : "Background image",
      width:
        target.kind === "img"
          ? imageElement.naturalWidth || imageElement.width || 0
          : Math.round(imageElement.getBoundingClientRect().width),
      height:
        target.kind === "img"
          ? imageElement.naturalHeight || imageElement.height || 0
          : Math.round(imageElement.getBoundingClientRect().height),
      base64: null,
      captureStatus: "pending",
      captureKind: target.kind,
    };

    try {
      if (target.kind === "img") {
        scrollElementIntoViewIfNeeded(imageElement);
        await sleep(120);
      }

      const captureResult = await captureImageBase64(
        imageElement,
        imgUrl,
        target.kind,
        platformId
      );
      imageRecord.base64 = captureResult.base64;
      imageRecord.captureMethod = captureResult.captureMethod;
      imageRecord.captureStatus = "success";

      if (target.kind === "img") {
        imageRecord.width = imageElement.naturalWidth || imageRecord.width;
        imageRecord.height = imageElement.naturalHeight || imageRecord.height;
      }
    } catch (error) {
      imageRecord.captureStatus = "failed";
      imageRecord.error = error.message;
    }

    sessionImages.push(imageRecord);
  }

  return sessionImages;
}

function scrapeChatGPTConversationTurns() {
  const entries = collectChatGPTMessageEntriesFromDom();
  if (!entries.length) {
    return null;
  }

  return buildConversationFromTurnEntries(
    entries.map(({ element, message }) => ({ element, message }))
  );
}

function refreshChatGPTMessageTurnElements(messages, messageTurns) {
  const domEntries = collectChatGPTMessageEntriesFromDom();
  const domByText = new Map();

  for (const entry of domEntries) {
    const textKey = `${entry.message.role}|${normalizeText(entry.message.text)}`;
    if (!domByText.has(textKey)) {
      domByText.set(textKey, entry.element);
    }
  }

  return safeArray(messageTurns).map((turn, index) => {
    const message = messages[index];
    const textKey = `${message?.role}|${normalizeText(message?.text)}`;
    return {
      ...turn,
      element: domByText.get(textKey) || turn.element,
    };
  });
}

function scrapeDataMessageRoleTurns() {
  const root = getScrapeRoot();
  const turnSelectors = [
    'div[data-message-author-role]:not([data-message-author-role] div[data-message-author-role])',
    '[data-message-author-role]:not([data-message-author-role] [data-message-author-role])',
    '[data-testid^="conversation-turn"] [data-message-author-role]',
    'article [data-message-author-role]',
  ];

  for (const selector of turnSelectors) {
    const turns = dedupeNestedElements(Array.from(root.querySelectorAll(selector)));
    if (turns.length === 0) {
      continue;
    }

    const entries = sortByDocumentOrder(turns)
      .map((element) => {
        const container = getMessageTurnContainer(element);
        const message = buildMessage(
          element.getAttribute("data-message-author-role"),
          element.innerText,
          0,
          { allowEmpty: turnHasChatMedia(container) }
        );
        return message ? { element: container, message } : null;
      })
      .filter(Boolean);

    if (entries.length > 0) {
      return buildConversationFromTurnEntries(entries);
    }
  }

  return null;
}

function scrapeChatGPT() {
  const conversationTurns = scrapeChatGPTConversationTurns();
  if (conversationTurns?.messages?.length) {
    return conversationTurns;
  }

  const roleTurns = scrapeDataMessageRoleTurns();
  if (roleTurns?.messages?.length) {
    return roleTurns;
  }

  return collectRoleMessages([
    { selector: 'div[data-message-author-role="user"]', role: "user" },
    { selector: 'div[data-message-author-role="assistant"]', role: "assistant" },
    { selector: '[data-message-author-role="user"]', role: "user" },
    { selector: '[data-message-author-role="assistant"]', role: "assistant" },
  ]);
}

function findGrokTurnElement(element) {
  let parent = element;

  while (parent && parent !== document.body) {
    const id = parent.getAttribute("id") || "";
    if (id.startsWith("response-")) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return element;
}

function scrapeGrokTestIdBubbles() {
  const bubbles = sortByDocumentOrder(
    dedupeNestedElements(
      querySelectorAllDeep(
        '[data-testid="user-message"], [data-testid="assistant-message"]'
      )
    )
  );

  if (!bubbles.length) {
    return null;
  }

  const entries = bubbles
    .map((element) => {
      const testId = element.getAttribute("data-testid") || "";
      const role = testId === "user-message" ? "user" : "assistant";
      const turnElement = findGrokTurnElement(element);
      const message = buildMessage(role, element.innerText, 0, {
        allowEmpty: elementHasSubstantiveContent(turnElement),
      });
      return message ? { element: getMessageTurnContainer(turnElement), message } : null;
    })
    .filter(Boolean);

  if (entries.length > 0) {
    return buildConversationFromTurnEntries(entries);
  }

  return null;
}

function scrapeGrokMessageBubbles() {
  const bubbles = sortByDocumentOrder(
    dedupeNestedElements(querySelectorAllDeep(".message-bubble"))
  );

  if (bubbles.length < 2) {
    return null;
  }

  const entries = bubbles
    .map((element, index) => {
      const hasAssistantMarkup = Boolean(
        element.querySelector(".response-content-markdown, [class*='response-content']")
      );
      const role =
        hasAssistantMarkup || index % 2 === 1 ? "assistant" : "user";
      const message = buildMessage(role, element.innerText, 0, {
        allowEmpty: elementHasSubstantiveContent(element),
      });
      return message ? { element, message } : null;
    })
    .filter(Boolean);

  if (entries.length > 0) {
    return buildConversationFromTurnEntries(entries);
  }

  return null;
}

function scrapeGrok() {
  const testIdResult = scrapeGrokTestIdBubbles();
  if (testIdResult?.messages?.length) {
    return testIdResult;
  }

  const bubbleResult = scrapeGrokMessageBubbles();
  if (bubbleResult?.messages?.length) {
    return bubbleResult;
  }

  return scrapeGenericPlatform("grok");
}

function scrapeGenericPlatform(platformId) {
  const roleTurns = scrapeDataMessageRoleTurns();
  if (roleTurns?.messages?.length) {
    return roleTurns;
  }

  const config = getGenericSelectorConfig(platformId);
  const selectorPairs = [];

  if (config?.user?.length) {
    for (const selector of config.user) {
      selectorPairs.push({ selector, role: "user" });
    }
  }

  if (config?.assistant?.length) {
    for (const selector of config.assistant) {
      selectorPairs.push({ selector, role: "assistant" });
    }
  }

  if (selectorPairs.length > 0) {
    const collected = collectRoleMessages(selectorPairs, {
      useDeepQuery: platformId === "grok" || platformId === "x-grok",
    });
    if (collected.messages.length > 0) {
      return collected;
    }
  }

  return collectRoleMessages(
    [
      { selector: '[data-message-author-role="user"]', role: "user" },
      { selector: '[data-message-author-role="assistant"]', role: "assistant" },
      { selector: '[data-message-author-role="model"]', role: "assistant" },
      { selector: '[data-testid="user-message"]', role: "user" },
      { selector: '[data-testid="assistant-message"]', role: "assistant" },
      { selector: '[data-testid="bot-message"]', role: "assistant" },
    ],
    { useDeepQuery: platformId === "grok" || platformId === "x-grok" }
  );
}

function scrapeGemini() {
  const roleTurns = scrapeDataMessageRoleTurns();
  if (roleTurns?.messages?.length) {
    return roleTurns;
  }

  return collectRoleMessages([
    { selector: '[data-message-author-role="user"]', role: "user" },
    { selector: '[data-message-author-role="model"]', role: "assistant" },
    { selector: '[data-message-author-role="assistant"]', role: "assistant" },
    { selector: ".query-text", role: "user" },
    { selector: ".user-query", role: "user" },
    { selector: "user-query", role: "user" },
    { selector: ".model-response-text", role: "assistant" },
    { selector: ".model-response", role: "assistant" },
    { selector: "model-response", role: "assistant" },
  ]);
}

function scrapeClaude() {
  return collectRoleMessages([
    { selector: '[data-testid="user-message"]', role: "user" },
    { selector: '[data-testid="human-message"]', role: "user" },
    { selector: ".font-user-message", role: "user" },
    { selector: '[data-testid="message-human"]', role: "user" },
    { selector: '[data-testid="assistant-message"]', role: "assistant" },
    { selector: '[data-testid="ai-message"]', role: "assistant" },
    { selector: ".font-claude-response", role: "assistant" },
    { selector: ".font-claude-message", role: "assistant" },
    { selector: '[data-testid="message-assistant"]', role: "assistant" },
  ]);
}

function readFirstVisibleText(selectors, root = document) {
  for (const selector of safeArray(selectors)) {
    const element = root.querySelector(selector);
    const text = normalizeText(
      element?.innerText ||
        element?.textContent ||
        element?.getAttribute?.("aria-label") ||
        element?.getAttribute?.("title") ||
        ""
    );
    if (text) {
      return text;
    }
  }

  return null;
}

function extractConversationIdFromUrl(href, platformId) {
  try {
    const url = new URL(String(href || window.location.href));
    const path = url.pathname;

    if (platformId === "chatgpt" || path.includes("/c/")) {
      const chatMatch = path.match(/\/c\/([a-f0-9-]+)/i);
      if (chatMatch?.[1]) {
        return chatMatch[1];
      }
    }

    if (platformId === "gemini") {
      const geminiMatch = path.match(/\/app\/([a-z0-9-]+)/i);
      if (geminiMatch?.[1]) {
        return geminiMatch[1];
      }
    }

    if (platformId === "claude") {
      const claudeMatch = path.match(/\/chat\/([a-z0-9-]+)/i);
      if (claudeMatch?.[1]) {
        return claudeMatch[1];
      }
    }

    if (platformId === "grok" || platformId === "x-grok") {
      const grokMatch = path.match(/\/c\/([a-z0-9-]+)/i);
      if (grokMatch?.[1]) {
        return grokMatch[1];
      }
    }

    const genericMatch = path.match(/\/([a-f0-9-]{8,}|[a-z0-9-]{12,})/i);
    return genericMatch?.[1] || null;
  } catch (_error) {
    return null;
  }
}

function collectVisiblePlatformFeatures(platformId, root = getScrapeRoot()) {
  const features = new Set();
  const bodyText = normalizeText(root.innerText || "").slice(0, 80000);

  if (/web search|searched the web|browsed|search results/i.test(bodyText)) {
    features.add("web-search");
  }
  if (/generated an image|dall·e|image generated|create an image/i.test(bodyText)) {
    features.add("image-generation");
  }
  if (/code interpreter|ran code|python/i.test(bodyText)) {
    features.add("code-execution");
  }
  if (/thought for|reasoned|extended thinking|thinking\.\.\./i.test(bodyText)) {
    features.add("extended-thinking");
  }
  if (/voice|audio file|\.wav|\.mp3/i.test(bodyText)) {
    features.add("audio");
  }
  if (/\.pdf|document|uploaded/i.test(bodyText)) {
    features.add("documents");
  }
  if (/\.mp4|video file|analyze this video/i.test(bodyText)) {
    features.add("video");
  }

  root.querySelectorAll('[data-testid*="tool"], [aria-label*="tool" i]').forEach((node) => {
    const label = normalizeText(node.getAttribute("aria-label") || node.textContent || "");
    if (label) {
      features.add(`tool:${label.slice(0, 80)}`);
    }
  });

  if (platformId) {
    features.add(`platform:${platformId}`);
  }

  return [...features];
}

function collectPlatformUiContext(platformId, host) {
  const context = {
    id: platformId || null,
    host: host || null,
  };

  if (platformId === "chatgpt" || host.includes("chatgpt.com")) {
    context.chatTitle =
      readFirstVisibleText([
        'nav a[aria-current="page"]',
        'nav [aria-current="page"]',
        '[data-testid="history-item"][aria-current="page"]',
      ]) || null;
    context.modelName =
      readFirstVisibleText([
        '[data-testid="model-switcher-dropdown-button"]',
        'button[data-testid="model-switcher"]',
        '[data-testid="model-switcher"]',
      ]) || null;
    context.customGptName =
      readFirstVisibleText(['[data-testid="gpt-name"]', 'a[href*="/g/"] h1', 'a[href*="/g/"]']) ||
      null;
    context.projectName =
      readFirstVisibleText(['[data-testid="project-name"]', '[aria-label*="Project" i]']) || null;
  } else if (platformId === "gemini") {
    context.modelName =
      readFirstVisibleText([
        '[data-testid="model-selector"]',
        'button[aria-label*="Gemini" i]',
        '[aria-label*="model" i]',
      ]) || null;
  } else if (platformId === "claude") {
    context.modelName =
      readFirstVisibleText([
        '[data-testid="model-selector"]',
        'button[aria-label*="Claude" i]',
        '[aria-label*="model" i]',
      ]) || null;
    context.chatTitle = readFirstVisibleText(["header h1", '[data-testid="chat-title"]']) || null;
  } else if (platformId === "grok" || platformId === "x-grok") {
    context.chatTitle = readFirstVisibleText(["main h1", '[data-testid="conversation-title"]']) || null;
  } else {
    context.chatTitle = readFirstVisibleText(["main h1", "header h1"]) || null;
  }

  context.visibleFeatures = collectVisiblePlatformFeatures(platformId);
  return context;
}

function summarizeAttachmentCapture(sessionImages, sessionVideos, sessionDocuments) {
  const countByStatus = (items) => ({
    referenced: safeArray(items).filter(
      (item) => item?.captureStatus === "success" || item?.captureStatus === "metadata-only"
    ).length,
    captured: safeArray(items).filter((item) => item?.captureStatus === "success").length,
    metadataOnly: safeArray(items).filter((item) => item?.captureStatus === "metadata-only")
      .length,
  });

  return {
    images: countByStatus(sessionImages),
    videos: countByStatus(sessionVideos),
    documents: countByStatus(sessionDocuments),
  };
}

function collectSessionContext(
  platformId,
  host,
  messages,
  { sessionImages, sessionVideos, sessionDocuments, scrollStats }
) {
  const capturedAt = new Date().toISOString();

  return {
    page: {
      url: window.location.href,
      path: window.location.pathname,
      hash: window.location.hash || null,
      title: document.title || null,
      referrer: document.referrer || null,
      language: document.documentElement.lang || navigator.language || null,
      conversationId: extractConversationIdFromUrl(window.location.href, platformId),
    },
    environment: {
      userAgent: navigator.userAgent,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      capturedAt,
    },
    platform: collectPlatformUiContext(platformId, host),
    interaction: {
      userMessages: messages.filter((message) => message.role === "user").length,
      assistantMessages: messages.filter((message) => message.role === "assistant").length,
      totalMessages: messages.length,
      attachments: summarizeAttachmentCapture(sessionImages, sessionVideos, sessionDocuments),
      scrollPasses: scrollStats?.passes ?? null,
      messagesAccumulated: scrollStats?.messagesAccumulated ?? null,
    },
  };
}

function enrichConversationWithMetadata(
  messages,
  messageTurns,
  { sessionImages, sessionVideos, sessionDocuments }
) {
  const mediaByAnchor = new Map();

  for (const item of [
    ...safeArray(sessionImages),
    ...safeArray(sessionVideos),
    ...safeArray(sessionDocuments),
  ]) {
    const anchor = Number(item?.afterMessageIndex);
    if (!Number.isFinite(anchor) || anchor <= 0) {
      continue;
    }

    if (!mediaByAnchor.has(anchor)) {
      mediaByAnchor.set(anchor, []);
    }
    mediaByAnchor.get(anchor).push(item);
  }

  return safeArray(messages).map((message, index) => {
    const turn = messageTurns[index];
    const element = turn?.element;
    const roleNode =
      element?.querySelector?.(
        '[data-message-author-role]:not([data-message-author-role] [data-message-author-role])'
      ) || element;
    const turnElement = roleNode?.closest?.('[data-testid^="conversation-turn"]');
    const turnId = turnElement?.getAttribute?.("data-testid") || null;
    const messageId =
      roleNode?.getAttribute?.("data-message-id") ||
      roleNode?.closest?.("[data-message-id]")?.getAttribute?.("data-message-id") ||
      null;
    const turnText = normalizeText(element?.innerText || element?.textContent || "");
    const attachmentFilenames = filterShadowDocumentFilenames([
      ...extractUserFileAttachmentFilenames(turnText),
    ]);

    for (const item of mediaByAnchor.get(message.index) || []) {
      const filename = String(item.filename || item.label || "").trim();
      if (filename) {
        attachmentFilenames.push(filename);
      }
    }

    const uniqueAttachments = [];
    const seenNames = new Set();
    for (const filename of attachmentFilenames) {
      const key = filename.toLowerCase();
      if (seenNames.has(key)) {
        continue;
      }
      seenNames.add(key);
      uniqueAttachments.push(filename);
    }

    const text = String(message.text || "");
    const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean) : [];

    return {
      ...message,
      meta: {
        turnId,
        messageId,
        charCount: text.length,
        wordCount: words.length,
        attachmentFilenames: uniqueAttachments,
        hasAttachments: uniqueAttachments.length > 0,
        hasCodeBlock:
          /```/.test(text) || Boolean(element?.querySelector?.("pre, code")),
        hasTable: Boolean(element?.querySelector?.("table")),
      },
    };
  });
}

const AUDIT_AUDIO_PATTERN =
  /\.(wav|wave|mp3|m4a|ogg|flac|aac|weba|aiff?|mid|midi)(\?|#|$)/i;
const AUDIT_VIDEO_PATTERN =
  /\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg)(\?|#|$)/i;
const AUDIT_PDF_PATTERN = /\.pdf(\?|#|$)/i;

function classifyAuditFilename(filename) {
  const name = String(filename || "").trim();
  if (!name) {
    return "other";
  }
  if (AUDIT_PDF_PATTERN.test(name)) {
    return "pdf";
  }
  if (AUDIT_AUDIO_PATTERN.test(name)) {
    return "audio";
  }
  if (AUDIT_VIDEO_PATTERN.test(name)) {
    return "video";
  }
  if (DOCUMENT_FILE_PATTERN.test(name)) {
    return "document";
  }
  return "other";
}

function uniqueAuditFilenames(items, status) {
  const seen = new Set();
  const results = [];

  for (const item of safeArray(items)) {
    if (status && item?.captureStatus !== status) {
      continue;
    }

    const name = String(item.filename || item.label || "").trim();
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(name);
  }

  return results;
}

function collectEnvironmentTelemetry() {
  const screen = window.screen || {};

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || null,
    language: navigator.language || null,
    languages: safeArray(navigator.languages).slice(0, 8),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localTimezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    screenResolution:
      screen.width && screen.height ? `${screen.width}x${screen.height}` : null,
    availableScreenResolution:
      screen.availWidth && screen.availHeight
        ? `${screen.availWidth}x${screen.availHeight}`
        : null,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  };
}

function buildUnexposedMediaManifest(sessionDocuments, sessionVideos) {
  const missingPdfs = [];
  const missingAudio = [];
  const missingVideo = [];
  const missingDocuments = [];
  const seen = new Set();

  const register = (filename) => {
    const name = String(filename || "").trim();
    if (!name) {
      return;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const kind = classifyAuditFilename(name);
    if (kind === "pdf") {
      missingPdfs.push(name);
    } else if (kind === "audio") {
      missingAudio.push(name);
    } else if (kind === "video") {
      missingVideo.push(name);
    } else {
      missingDocuments.push(name);
    }
  };

  for (const item of safeArray(sessionDocuments)) {
    if (item?.captureStatus === "metadata-only") {
      register(item.filename || item.label);
    }
  }

  for (const item of safeArray(sessionVideos)) {
    if (item?.captureStatus === "metadata-only") {
      register(item.filename || item.label);
    }
  }

  return { missingPdfs, missingAudio, missingVideo, missingDocuments };
}

function buildExposedMediaManifest(sessionImages, sessionVideos, sessionDocuments) {
  return {
    images: uniqueAuditFilenames(
      safeArray(sessionImages).map((item) => ({
        ...item,
        filename: item.filename || item.label || item.alt || `image-${item.index || ""}`,
      })),
      "success"
    ),
    videos: uniqueAuditFilenames(sessionVideos, "success"),
    documents: uniqueAuditFilenames(sessionDocuments, "success"),
  };
}

function truncateAuditText(text, maxLength = 180) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function inferMediaKind(item) {
  const mimeType = String(item?.mimeType || "").toLowerCase();
  const filename = String(item?.filename || item.label || "").trim();

  if (mimeType.startsWith("image/") || item?.captureKind === "img") {
    return "image";
  }
  if (mimeType.startsWith("video/") || AUDIT_VIDEO_PATTERN.test(filename)) {
    return "video";
  }
  if (mimeType.startsWith("audio/") || AUDIT_AUDIO_PATTERN.test(filename)) {
    return "audio";
  }
  return "document";
}

function buildInteractionTimeline(
  conversation,
  sessionImages,
  sessionVideos,
  sessionDocuments
) {
  const events = [];
  const mediaByAnchor = new Map();

  for (const item of [
    ...safeArray(sessionImages),
    ...safeArray(sessionVideos),
    ...safeArray(sessionDocuments),
  ]) {
    const anchor = Number(item?.afterMessageIndex);
    if (!Number.isFinite(anchor) || anchor <= 0) {
      continue;
    }

    if (!mediaByAnchor.has(anchor)) {
      mediaByAnchor.set(anchor, []);
    }
    mediaByAnchor.get(anchor).push(item);
  }

  for (const message of safeArray(conversation)) {
    const messageIndex = message.index;
    const role = message.role;
    const meta = message.meta || {};

    events.push({
      sequence: events.length + 1,
      messageIndex,
      role,
      type: role === "user" ? "user-message" : "assistant-message",
      turnId: meta.turnId || null,
      messageId: meta.messageId || null,
      summary: truncateAuditText(message.text),
      wordCount: meta.wordCount ?? null,
      attachmentFilenames: meta.attachmentFilenames || [],
      flags: {
        hasAttachments: Boolean(meta.hasAttachments),
        hasCodeBlock: Boolean(meta.hasCodeBlock),
        hasTable: Boolean(meta.hasTable),
      },
    });

    for (const item of mediaByAnchor.get(messageIndex) || []) {
      const mediaKind = inferMediaKind(item);
      const filename =
        String(item.filename || item.label || item.alt || "").trim() || null;
      const captureStatus = item.captureStatus || "unknown";
      const isSuccess = captureStatus === "success";
      const isMetadataOnly = captureStatus === "metadata-only";

      let type = `${mediaKind}-referenced`;
      if (isSuccess) {
        type = `${mediaKind}-captured`;
      } else if (isMetadataOnly) {
        type = `${mediaKind}-unexposed`;
      } else if (captureStatus === "failed") {
        type = `${mediaKind}-failed`;
      }

      events.push({
        sequence: events.length + 1,
        messageIndex,
        role,
        type,
        mediaKind,
        filename,
        captureStatus,
        captureMethod: item.captureMethod || null,
        summary: isMetadataOnly
          ? `${filename || mediaKind} referenced in chat but not exposed in the page DOM at sign-off`
          : isSuccess
            ? `${filename || mediaKind} captured successfully`
            : `${filename || mediaKind} capture ${captureStatus}`,
      });
    }
  }

  return events;
}

function buildInteractionSummary(auditRecord) {
  const session = auditRecord?.sessionContext || {};
  const unexposed = auditRecord?.unexposedMediaManifest || {};
  const exposed = auditRecord?.exposedMediaManifest || {};
  const parts = [];

  parts.push(
    `Human–AI session on ${session.sourcePlatform || "unknown"}` +
      (session.scrapedModel ? ` using ${session.scrapedModel}` : "") +
      "."
  );

  if (session.sessionTitle) {
    parts.push(`Topic: "${session.sessionTitle}".`);
  }

  parts.push(
    `${session.turnCount ?? 0} messages recorded (${session.userTurnCount ?? 0} user, ${session.assistantTurnCount ?? 0} assistant).`
  );

  const unexposedCount =
    safeArray(unexposed.missingPdfs).length +
    safeArray(unexposed.missingAudio).length +
    safeArray(unexposed.missingVideo).length +
    safeArray(unexposed.missingDocuments).length;

  if (unexposedCount > 0) {
    parts.push(
      `${unexposedCount} attachment(s) were referenced but could not be downloaded from the page at sign-off.`
    );
  }

  const exposedCount =
    safeArray(exposed.images).length +
    safeArray(exposed.videos).length +
    safeArray(exposed.documents).length;

  if (exposedCount > 0) {
    parts.push(`${exposedCount} attachment(s) were captured in full.`);
  }

  if (safeArray(session.sessionFeatures).length) {
    parts.push(`Session features detected: ${session.sessionFeatures.join(", ")}.`);
  }

  return parts.join(" ");
}

function buildAuditRecord({
  platformId,
  host,
  sessionContext,
  conversation,
  sessionImages,
  sessionVideos,
  sessionDocuments,
  scrollStats,
}) {
  const page = sessionContext?.page || {};
  const platform = sessionContext?.platform || {};
  const interaction = sessionContext?.interaction || {};
  const environmentTelemetry = collectEnvironmentTelemetry();
  const unexposedMediaManifest = buildUnexposedMediaManifest(
    sessionDocuments,
    sessionVideos
  );
  const exposedMediaManifest = buildExposedMediaManifest(
    sessionImages,
    sessionVideos,
    sessionDocuments
  );

  const auditRecord = {
    schemaVersion: 1,
    recordedAt: sessionContext?.environment?.capturedAt || new Date().toISOString(),
    sessionContext: {
      sourcePlatform: platformId || host,
      sourcePlatformHost: host,
      scrapedModel: platform.modelName || null,
      sessionUrl: page.url || null,
      sessionTitle: platform.chatTitle || page.title || null,
      conversationId: page.conversationId || null,
      customGptName: platform.customGptName || null,
      projectName: platform.projectName || null,
      turnCount: interaction.totalMessages ?? conversation.length,
      userTurnCount: interaction.userMessages ?? null,
      assistantTurnCount: interaction.assistantMessages ?? null,
      scrollPasses: interaction.scrollPasses ?? scrollStats?.passes ?? null,
      viewportCheckpointsPerPass: CHAT_SCROLL_CHECKPOINTS.length,
      sessionFeatures: platform.visibleFeatures || [],
    },
    environmentTelemetry,
    unexposedMediaManifest,
    exposedMediaManifest,
    interactionTimeline: buildInteractionTimeline(
      conversation,
      sessionImages,
      sessionVideos,
      sessionDocuments
    ),
    captureIntegrity: {
      captureSchemaVersion: 7,
      captureBuild: globalThis.__NINK_SCRAPER_BUILD__ || "unknown",
      messagesCaptured: conversation.length,
      scrollRootFound: scrollStats?.scrollRootFound ?? null,
      messagesAccumulated: scrollStats?.messagesAccumulated ?? null,
      roleNodesVisible: scrollStats?.roleNodesAfter ?? null,
    },
  };

  auditRecord.interactionSummary = buildInteractionSummary(auditRecord);
  return auditRecord;
}

async function scrapeChatSession() {
  const host = window.location.hostname;
  const platform = detectPlatform();
  const platformId = platform?.id || null;
  const containers = getChatContainers(host, platformId);

  let scrollStats = {};
  let savedScrollPositions = [];
  let messages = [];
  let messageTurns = [];

  try {
    if (platformId === "chatgpt") {
      const accumulated = await accumulateChatGPTConversation(containers);
      scrollStats = accumulated.scrollStats || {};
      savedScrollPositions = accumulated.savedPositions || [];
      messages = safeArray(accumulated.messages);
      messageTurns = safeArray(accumulated.messageTurns);
    } else {
      const scrollResult = await scrollChatToLoadLazyContent(containers);
      scrollStats = scrollResult.stats || {};
      savedScrollPositions = scrollResult.savedPositions || [];

      try {
        let conversationResult = { messages: [], messageTurns: [] };

        if (platformId === "gemini") {
          conversationResult = scrapeGemini();
        } else if (platformId === "claude") {
          conversationResult = scrapeClaude();
        } else if (platformId === "grok" || platformId === "x-grok") {
          conversationResult = scrapeGrok();
        } else if (platformId) {
          conversationResult = scrapeGenericPlatform(platformId);
        }

        messages = safeArray(conversationResult.messages);
        messageTurns = safeArray(conversationResult.messageTurns);
      } catch (error) {
        console.warn("NINK message scrape failed:", error);
        messages = [];
        messageTurns = [];
      }
    }
  } catch (error) {
    console.warn("NINK scroll/message scrape failed:", error);
    messages = [];
    messageTurns = [];
  }

  let sessionImages = [];
  let sessionVideos = [];
  let sessionDocuments = [];
  let documentTargets = [];
  let imagePreviewDocuments = [];

  try {
    if (platformId === "chatgpt" && messages.length) {
      const scrollRoot = getPrimaryChatScrollRoot(containers);
      if (scrollRoot) {
        scrollRoot.scrollTop = scrollRoot.scrollHeight;
        await sleep(80);
      }
      messageTurns = refreshChatGPTMessageTurnElements(messages, messageTurns);
    }

    try {
      sessionImages = await captureSessionImages(host, messageTurns, platformId);
    } catch (error) {
      console.warn("NINK image capture failed:", error);
      sessionImages = [];
    }

    try {
      sessionVideos = await captureSessionVideos(host, messageTurns, platformId, messages);
    } catch (error) {
      console.warn("NINK video capture failed:", error);
      sessionVideos = [];
    }

    try {
      documentTargets = safeArray(findAttachmentDocumentTargets(messageTurns, host, messages));
    } catch (error) {
      console.warn("NINK document target discovery failed:", error);
      documentTargets = [];
    }

    try {
      sessionDocuments = await captureSessionDocuments(
        host,
        messageTurns,
        platformId,
        documentTargets
      );
    } catch (error) {
      console.warn("NINK document capture failed:", error);
      sessionDocuments = [];
    }

    sessionImages = safeArray(sessionImages);
    sessionVideos = safeArray(sessionVideos);
    sessionDocuments = safeArray(sessionDocuments);

    try {
      imagePreviewDocuments = buildDocumentsFromUserTurnImages(sessionImages, messageTurns);
    } catch (error) {
      console.warn("NINK document image-preview promotion failed:", error);
      imagePreviewDocuments = [];
    }

    sessionDocuments = mergeSessionDocuments(sessionDocuments, imagePreviewDocuments);
    sessionDocuments = dedupeSessionDocuments(sessionDocuments);
  } finally {
    restoreChatScrollPositions(savedScrollPositions);
  }

  const mainImageCount = getScrapeRoot().querySelectorAll("img").length;
  const mainVideoCount = getScrapeRoot().querySelectorAll("video").length;
  const sessionContext = collectSessionContext(platformId, host, messages, {
    sessionImages,
    sessionVideos,
    sessionDocuments,
    scrollStats,
  });
  const conversation = enrichConversationWithMetadata(messages, messageTurns, {
    sessionImages,
    sessionVideos,
    sessionDocuments,
  });
  const auditRecord = buildAuditRecord({
    platformId,
    host,
    sessionContext,
    conversation,
    sessionImages,
    sessionVideos,
    sessionDocuments,
    scrollStats,
  });

  return {
    captureSchemaVersion: 7,
    captureBuild: globalThis.__NINK_SCRAPER_BUILD__ || "unknown",
    sourcePlatform: platformId || host,
    sourcePlatformHost: host,
    timestamp: Date.now(),
    sessionContext,
    auditRecord,
    conversation,
    messageCount: conversation.length,
    sessionImages,
    imageCount: sessionImages.length,
    sessionVideos,
    videoCount: sessionVideos.length,
    sessionDocuments,
    documentCount: sessionDocuments.length,
    scrollDiscovery: {
      ...scrollStats,
      turnsVisible: countLikelyTurns(),
      conversationTurnsVisible: countConversationTurns(),
      roleNodesVisible: countScrapeableRoleNodes(),
      messagesCaptured: messages.length,
    },
    imageDiscovery: {
      containersScanned: containers.length,
      targetsFound: sessionImages.length,
      mainImageCount,
      mainVideoCount,
      successfulCaptures: sessionImages.filter(
        (image) => image?.captureStatus === "success"
      ).length,
      successfulVideoCaptures: sessionVideos.filter(
        (video) => video?.captureStatus === "success"
      ).length,
    },
    documentDiscovery: {
      targetsFound: documentTargets.length,
      imagePreviewPromoted: imagePreviewDocuments.length,
      userTurnsScanned: messageTurns.filter((turn) => turn.role === "user").length,
      textMentionsFound: documentTargets.filter(
        (target) => target.kind === "document-text-mention"
      ).length,
      successfulCaptures: sessionDocuments.filter(
        (document) => document?.captureStatus === "success"
      ).length,
      documentsReferenced: sessionDocuments.filter(
        (document) =>
          document?.captureStatus === "success" ||
          document?.captureStatus === "metadata-only"
      ).length,
    },
  };
}

globalThis.__NINK_scrapeChatSession__ = scrapeChatSession;
})();
