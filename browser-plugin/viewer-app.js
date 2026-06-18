document.addEventListener('dragover', function (e) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}, true);
document.addEventListener('drop', function (e) { e.preventDefault(); }, true);


    const IV_LENGTH = 12;

    let loadedSession = null;
    let loadedNinkFileName = "";
    let loadedSecretKey = "";
    let loadedKeyMeta = null;
    let pendingKey = null;

    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    const keyStatus = document.getElementById("key-status");
    const decryptButton = document.getElementById("decrypt-btn");
    const errorBanner = document.getElementById("error-banner");
    const metadataPanel = document.getElementById("metadata-panel");
    const decryptPanel = document.getElementById("decrypt-panel");
    const chatPanel = document.getElementById("chat-panel");
    const stepLogEl = document.getElementById("step-log");
    const pageUrlEl = document.getElementById("page-url");

    function logStep(message) {
      const line = `${new Date().toLocaleTimeString()} — ${message}`;
      console.log("[NINK viewer]", line);
      if (!stepLogEl) {
        return;
      }
      stepLogEl.textContent = stepLogEl.textContent
        ? `${stepLogEl.textContent}\n${line}`
        : line;
      stepLogEl.scrollTop = stepLogEl.scrollHeight;
    }

    if (pageUrlEl) {
      pageUrlEl.textContent = location.href;
    }
    logStep(`Page loaded (${location.protocol}) — viewer-app.js running`);

    let ninkConfig = { strictCloudMode: true };

    function strictCloudHelpers() {
      return globalThis.__NINK_STRICT_CLOUD__ || {};
    }

    async function loadNinkConfig() {
      if (!chrome?.storage?.local) {
        return;
      }

      const stored = await new Promise((resolve) => {
        chrome.storage.local.get("ninkConfig", resolve);
      });
      ninkConfig = { strictCloudMode: true, ...(stored.ninkConfig || {}) };
    }

    function cloudUnlockRequired() {
      const helpers = strictCloudHelpers();
      if (helpers.requiresCloudUnlock) {
        return helpers.requiresCloudUnlock(loadedSession, ninkConfig);
      }
      return Boolean(loadedSession?.packageId);
    }

    function updatePackageModeBanner() {
      const banner = document.getElementById("package-mode-banner");
      if (!banner) {
        return;
      }

      if (!loadedSession) {
        banner.classList.add("hidden");
        banner.textContent = "";
        return;
      }

      banner.classList.remove("hidden");
      const helpers = strictCloudHelpers();

      if (cloudUnlockRequired()) {
        banner.textContent = "Cloud-backed package: paid unlock required";
        banner.className = "package-mode-banner cloud-required";
        return;
      }

      if (helpers.isLocalOnlyPackage?.(loadedSession)) {
        banner.textContent = "Local-only package: free local decrypt";
        banner.className = "package-mode-banner local-free";
        return;
      }

      if (loadedSession.packageId) {
        banner.textContent =
          "Cloud-backed package: dev mode — free local decrypt allowed (strict cloud mode off)";
        banner.className = "package-mode-banner dev-local";
      }
    }

    function getKeyFileName(ninkFileName) {
      return String(ninkFileName || "").replace(/\.nink$/i, ".ninkkey");
    }

    function normalizeKeyText(text) {
      return String(text || "").trim().replace(/\s+/g, "");
    }

    function isNinkArchiveName(name) {
      return /\.nink$/i.test(String(name || ""));
    }

    function isNinkKeyName(name) {
      return /\.ninkkey$/i.test(String(name || ""));
    }

    function setKeyStatus(message, isSuccess = false) {
      keyStatus.textContent = message;
      keyStatus.classList.toggle("success", isSuccess);
    }

    function keyMatchesNink(ninkFileName, keyFileName) {
      const expected = getKeyFileName(ninkFileName).toLowerCase();
      const keyLower = String(keyFileName || "").toLowerCase();
      if (keyLower === expected) {
        return true;
      }

      const stem = String(ninkFileName || "").replace(/\.nink$/i, "").toLowerCase();
      return keyLower === `${stem}.ninkkey` || keyLower.startsWith(`${stem}.`);
    }

    function applyPendingKey(sourceLabel, autoDecrypt = true) {
      if (cloudUnlockRequired()) {
        pendingKey = null;
        loadedSecretKey = "";
        loadedKeyMeta = null;
        decryptButton.hidden = true;
        setKeyStatus(
          "Cloud-backed package: paid unlock required — use Cloud unlock below (local .ninkkey disabled).",
          false
        );
        updatePackageModeBanner();
        globalThis.__NINK_refreshCloudPanel__?.();
        return false;
      }

      if (!pendingKey?.keyText) {
        return false;
      }

      const parsed = parseKeyFileText(pendingKey.keyText);
      if (!parsed.key) {
        return false;
      }

      loadedSecretKey = parsed.key;
      loadedKeyMeta = parsed.meta ?? pendingKey.meta ?? null;
      decryptButton.hidden = !loadedSecretKey;

      if (sourceLabel) {
        setKeyStatus(sourceLabel, true);
      }

      if (autoDecrypt && loadedSecretKey && loadedSession?.encryptedPayload) {
        handleDecrypt();
      }

      globalThis.__NINK_refreshCloudPanel__?.();
      return true;
    }

    function resetConversationView() {
      loadedSecretKey = "";
      loadedKeyMeta = null;
      decryptButton.hidden = true;
      chatPanel.classList.add("hidden");
      document.getElementById("chat-log").innerHTML = "";
    }

    function parseKeyFileText(text) {
      const raw = String(text || "").trim();
      if (!raw) {
        return { key: "", meta: null };
      }

      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const keyCandidate =
            parsed.aesKeyBase64 || parsed.key || parsed.secretKey || parsed.aesKey;
          if (keyCandidate) {
            return {
              key: normalizeKeyText(keyCandidate),
              meta: parsed,
            };
          }
        }
      } catch (_error) {
        // Plain-text .ninkkey files remain base64-only for now.
      }

      return { key: normalizeKeyText(raw), meta: null };
    }

    function pickCompanionKeyFile(ninkFileName, files) {
      const expectedKeyName = getKeyFileName(ninkFileName).toLowerCase();
      const list = Array.from(files || []);

      const exactMatch = list.find(
        (file) => String(file.name || "").toLowerCase() === expectedKeyName
      );
      if (exactMatch) {
        return exactMatch;
      }

      return list.find((file) => isNinkKeyName(file.name)) || null;
    }

    function splitIncomingFiles(files) {
      const list = Array.from(files || []);
      const ninkFile =
        list.find((file) => isNinkArchiveName(file.name)) ||
        list.find((file) => /\.json$/i.test(String(file.name || ""))) ||
        null;
      const keyFile = ninkFile ? pickCompanionKeyFile(ninkFile.name, list) : null;
      return { ninkFile, keyFile, allFiles: list };
    }

    async function stashKeyFromFile(file) {
      if (cloudUnlockRequired()) {
        showError(
          "Local .ninkkey decrypt is disabled for cloud-backed packages. Sign in and use Cloud unlock."
        );
        return false;
      }

      const keyText = await file.text();
      const parsed = parseKeyFileText(keyText);
      if (!parsed.key) {
        showError("Key file was empty.");
        return false;
      }

      pendingKey = {
        fileName: file.name,
        keyText,
        meta: parsed.meta,
      };
      return true;
    }

    async function attemptAutoLoadKey(ninkFileName, companionKeyFile) {
      if (cloudUnlockRequired()) {
        setKeyStatus(
          "Cloud-backed package: paid unlock required — use the Cloud unlock panel below.",
          false
        );
        updatePackageModeBanner();
        globalThis.__NINK_refreshCloudPanel__?.();
        return false;
      }

      if (companionKeyFile) {
        await stashKeyFromFile(companionKeyFile);
      }

      if (pendingKey?.keyText && keyMatchesNink(ninkFileName, pendingKey.fileName)) {
        applyPendingKey(`Loaded ${pendingKey.fileName}`, true);
        return true;
      }

      if (pendingKey?.keyText) {
        pendingKey = null;
      }

      setKeyStatus(
        `Loaded ${ninkFileName}. Drop the matching ${getKeyFileName(ninkFileName)} on the upload area above.`
      );
      return false;
    }

    async function loadKeyFromUserFile(file) {
      if (!file) {
        return;
      }

      if (!(await stashKeyFromFile(file))) {
        return;
      }

      clearError();

      if (loadedSession?.encryptedPayload) {
        applyPendingKey(`Loaded ${file.name}`, true);
        return;
      }

      setKeyStatus(`Loaded ${file.name}. Drop the matching .nink file above.`, true);
    }

    async function processIncomingFiles(files) {
      const list = Array.from(files || []);
      logStep(`Files received: ${list.length} — ${list.map((f) => f.name).join(", ")}`);

      const { ninkFile, keyFile } = splitIncomingFiles(list);

      if (!ninkFile) {
        const keyOnly = list.find((file) => isNinkKeyName(file.name));
        if (keyOnly) {
          await loadKeyFromUserFile(keyOnly);
          return;
        }

        showError("Attach a .nink archive (and matching .ninkkey if you have it).");
        return;
      }

      clearError();
      loadedNinkFileName = ninkFile.name;
      logStep(`Reading ${ninkFile.name}…`);
      const text = await ninkFile.text();
      resetConversationView();

      if (!loadSessionFromText(text)) {
        logStep("Failed: .nink JSON invalid or missing encryptedPayload");
        loadedNinkFileName = "";
        return;
      }

      logStep("Session JSON OK — loading key…");
      await attemptAutoLoadKey(loadedNinkFileName, keyFile);
    }

    function openArchivePicker() {
      logStep("Opening file picker (click Choose/Open once with both files)…");
      fileInput.value = "";
      fileInput.click();
    }

    function showError(message) {
      errorBanner.textContent = message;
      errorBanner.classList.remove("hidden");
    }

    function clearError() {
      errorBanner.textContent = "";
      errorBanner.classList.add("hidden");
    }

    function base64ToUint8Array(base64) {
      const normalized = String(base64 || "").trim();
      if (!normalized) {
        throw new Error("Missing base64 input.");
      }

      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    function setMetadata(session) {
      document.getElementById("meta-version").textContent = session.version || "—";
      document.getElementById("meta-network").textContent = session.blockchainNetwork || "—";
      document.getElementById("meta-tx").textContent = session.transactionHash || "—";
      document.getElementById("meta-state").textContent = session.stateHash || "—";
      metadataPanel.classList.remove("hidden");
      decryptPanel.classList.remove("hidden");
      chatPanel.classList.add("hidden");
      document.getElementById("chat-log").innerHTML = "";
      updatePackageModeBanner();
      globalThis.__NINK_refreshCloudPanel__?.();
    }

    function loadSessionFromText(text) {
      clearError();
      let session;

      try {
        session = JSON.parse(text);
      } catch (_error) {
        showError("Invalid JSON file. Drop a valid NINK session export.");
        return false;
      }

      if (!session || typeof session !== "object") {
        showError("Session file is empty or malformed.");
        return false;
      }

      if (!session.encryptedPayload) {
        showError("Session file is missing encryptedPayload.");
        return false;
      }

      loadedSession = session;
      setMetadata(session);
      return true;
    }

    async function handleDecrypt() {
      clearError();

      if (cloudUnlockRequired()) {
        showError(
          "Cloud-backed package requires paid Cloud unlock. Local .ninkkey decrypt is disabled in production mode."
        );
        return;
      }

      if (!loadedSession?.encryptedPayload) {
        showError("Load a session file before decrypting.");
        return;
      }

      if (!window.crypto?.subtle) {
        showError(
          "Web Crypto is unavailable. Open viewer.html via http://127.0.0.1 (not file://). " +
          "Example: npx serve . from the nink-browser-plugin folder."
        );
        return;
      }

      if (!loadedSecretKey) {
        showError(`Attach the matching ${getKeyFileName(loadedNinkFileName)} file above.`);
        return;
      }

      try {
        logStep("Decrypting…");
        const sessionData = await decryptPayload(
          loadedSession.encryptedPayload,
          loadedSecretKey,
          loadedSession.payloadCompression
        );
        renderConversation(sessionData);
        logStep("Decrypt OK — conversation rendered");
        globalThis.__NINK_refreshCloudPanel__?.();
      } catch (error) {
        logStep(`Decrypt failed: ${error.message}`);
        showError(`Decryption failed: ${error.message}`);
      }
    }

    async function importAesKey(base64Key) {
      const keyBytes = base64ToUint8Array(base64Key);

      if (keyBytes.length !== 32) {
        throw new Error("AES key must be 32 bytes (base64-encoded raw key from the matching .ninkkey file).");
      }

      return crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
    }

    async function gzipDecompress(bytes) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("DecompressionStream (gzip) is not available in this browser.");
      }

      const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function decodeDecryptedPayload(decryptedBytes, payloadCompression) {
      let jsonBytes = decryptedBytes;

      if (payloadCompression === "gzip") {
        jsonBytes = await gzipDecompress(decryptedBytes);
      } else {
        try {
          jsonBytes = await gzipDecompress(decryptedBytes);
        } catch (_error) {
          jsonBytes = decryptedBytes;
        }
      }

      const parsed = JSON.parse(new TextDecoder().decode(jsonBytes));

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Decrypted payload was not a valid session object.");
      }

      return parsed;
    }

    async function decryptPayload(encryptedPayloadBase64, base64Key, payloadCompression) {
      const encryptedBytes = base64ToUint8Array(encryptedPayloadBase64);

      if (encryptedBytes.length <= IV_LENGTH) {
        throw new Error("Encrypted payload is too short to contain IV + ciphertext.");
      }

      const iv = encryptedBytes.slice(0, IV_LENGTH);
      const ciphertext = encryptedBytes.slice(IV_LENGTH);
      const cryptoKey = await importAesKey(base64Key);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        ciphertext
      );

      return decodeDecryptedPayload(new Uint8Array(decryptedBuffer), payloadCompression);
    }

    function normalizeRole(role) {
      const value = String(role || "").toLowerCase();
      if (value === "user" || value === "human") {
        return "user";
      }
      return "assistant";
    }

    function normalizeImageSrc(base64Value) {
      const value = String(base64Value || "").trim();
      if (!value) {
        return "";
      }
      if (value.startsWith("data:")) {
        return value;
      }
      return `data:image/png;base64,${value}`;
    }

    function documentFilenamesOverlap(left, right) {
      const normalize = (value) =>
        String(value || "")
          .trim()
          .split(/[/\\]/)
          .pop()
          .toLowerCase();
      const leftName = normalize(left);
      const rightName = normalize(right);

      if (!leftName || !rightName) {
        return false;
      }

      if (leftName === rightName) {
        return true;
      }

      return leftName.endsWith(rightName) || rightName.endsWith(leftName);
    }

    function collapseEquivalentDocuments(documents) {
      const grouped = new Map();

      for (const document of documents) {
        const anchor = Number(document?.afterMessageIndex) || 0;
        if (!grouped.has(anchor)) {
          grouped.set(anchor, []);
        }
        grouped.get(anchor).push(document);
      }

      const collapsed = [];
      for (const list of grouped.values()) {
        const sorted = [...list].sort(
          (left, right) =>
            String(right.filename || right.label || "").length -
            String(left.filename || left.label || "").length
        );
        const kept = [];

        for (const candidate of sorted) {
          const candidateName = candidate.filename || candidate.label || "";
          const isShadow = kept.some((existing) =>
            documentFilenamesOverlap(
              existing.filename || existing.label,
              candidateName
            )
          );

          if (!isShadow) {
            kept.push(candidate);
          }
        }

        collapsed.push(...kept);
      }

      return collapsed;
    }

    function normalizeAttachmentFilename(value) {
      return String(value || "")
        .trim()
        .split(/[/\\]/)
        .pop()
        .toLowerCase();
    }

    function dedupeMetadataOnlyByFilename(mediaItems) {
      const seenFilenames = new Set();

      return mediaItems.filter((item) => {
        if (item?.captureStatus !== "metadata-only") {
          return true;
        }

        const filename = normalizeAttachmentFilename(item.filename || item.label);
        if (!filename) {
          return true;
        }

        if (seenFilenames.has(filename)) {
          return false;
        }

        seenFilenames.add(filename);
        return true;
      });
    }

    function mediaDedupeKey(item) {
      const anchor = Number(item?.afterMessageIndex) || 0;
      const filename = String(item?.filename || item?.label || "")
        .trim()
        .toLowerCase();

      if (item?.captureStatus === "metadata-only" && filename) {
        return `missing:${filename}`;
      }

      if (item?.relatedImageIndex) {
        return `related-image:${item.relatedImageIndex}`;
      }

      if (isDocumentMediaItem(item) && filename) {
        return `doc:${anchor}:${filename}`;
      }

      if (item?.captureKind === "video" || String(item?.mimeType || "").startsWith("video/")) {
        return `video:${anchor}:${filename || item.index || item.sourceUrl || ""}`;
      }

      return `image:${anchor}:${item.index || ""}:${item.sourceUrl || item.alt || ""}`;
    }

    function buildMediaByMessageIndex(messages, mediaItems) {
      const grouped = new Map();
      const unanchored = [];
      const seenKeys = new Set();

      for (const item of mediaItems) {
        if (item?.captureStatus !== "success" && item?.captureStatus !== "metadata-only") {
          continue;
        }

        if (!item?.base64 && item?.captureStatus !== "metadata-only") {
          continue;
        }

        const dedupeKey = mediaDedupeKey(item);
        if (seenKeys.has(dedupeKey)) {
          continue;
        }
        seenKeys.add(dedupeKey);

        const anchor = Number(item.afterMessageIndex);
        if (Number.isFinite(anchor) && anchor > 0) {
          if (!grouped.has(anchor)) {
            grouped.set(anchor, []);
          }
          grouped.get(anchor).push(item);
        } else {
          unanchored.push(item);
        }
      }

      for (const list of grouped.values()) {
        list.sort(
          (left, right) =>
            (left.documentOrder ?? left.index ?? 0) - (right.documentOrder ?? right.index ?? 0)
        );
      }

      if (unanchored.length > 0) {
        let queueIndex = 0;
        for (const message of messages) {
          if (queueIndex >= unanchored.length) {
            break;
          }
          if (!grouped.has(message.index)) {
            grouped.set(message.index, []);
          }
          grouped.get(message.index).push(unanchored[queueIndex]);
          queueIndex += 1;
        }

        const lastMessage = messages[messages.length - 1];
        while (queueIndex < unanchored.length && lastMessage) {
          if (!grouped.has(lastMessage.index)) {
            grouped.set(lastMessage.index, []);
          }
          grouped.get(lastMessage.index).push(unanchored[queueIndex]);
          queueIndex += 1;
        }
      }

      return grouped;
    }

    function appendInlineMedia(container, mediaItems, role) {
      const wrap = document.createElement("div");
      wrap.className = `message-images ${role}`;

      mediaItems.forEach((item) => {
        if (item.captureStatus === "metadata-only") {
          const figure = document.createElement("figure");
          figure.className = "attachment-placeholder attachment-warning";

          const name = document.createElement("strong");
          name.className = "attachment-warning-name";
          name.textContent = attachmentPlaceholderLabel(item);

          const note = document.createElement("span");
          note.className = "attachment-warning-note";
          note.textContent =
            "Referenced in chat, but the file is not exposed in the page DOM at sign-off time.";

          figure.appendChild(name);
          figure.appendChild(note);
          wrap.appendChild(figure);
          return;
        }

        if (isDocumentMediaItem(item)) {
          appendDocumentPreview(wrap, item);
          return;
        }

        const mimeType = String(item.mimeType || "").toLowerCase();
        const isVideo =
          item.captureKind === "video" && mimeType.startsWith("video/");

        if (isVideo) {
          const figure = document.createElement("figure");
          figure.className = "inline-video";

          const video = document.createElement("video");
          video.className = "inline-video-player";
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.src = normalizeVideoSrc(item.base64, item.mimeType);

          figure.appendChild(video);
          wrap.appendChild(figure);
          return;
        }

        const figure = document.createElement("figure");
        figure.className = "inline-image";

        const img = document.createElement("img");
        img.src = normalizeImageSrc(item.base64);
        img.alt = String(item.alt || "").trim() || "Session image";
        img.loading = "lazy";

        figure.appendChild(img);
        wrap.appendChild(figure);
      });

      container.appendChild(wrap);
    }

    function appendMessageBubble(container, message, options = {}) {
      const role = normalizeRole(message.role);
      const text = String(message.text || "").trim();
      const hasMedia = Boolean(options.hasMedia);

      if (!text && !hasMedia) {
        return;
      }

      const bubble = document.createElement("article");
      bubble.className = `message ${role}`;

      const roleLabel = document.createElement("div");
      roleLabel.className = "message-role";
      roleLabel.textContent = role === "user" ? "User" : "Assistant";

      const body = document.createElement("div");
      body.className = "message-text";
      body.textContent = text || "(attachment)";

      bubble.appendChild(roleLabel);
      bubble.appendChild(body);
      container.appendChild(bubble);
    }

    function normalizeVideoSrc(base64Value, mimeType) {
      const value = String(base64Value || "").trim();
      if (!value) {
        return "";
      }
      if (value.startsWith("data:")) {
        return value;
      }
      const mime = String(mimeType || "video/webm").trim() || "video/webm";
      return `data:${mime};base64,${value}`;
    }

    function normalizeDocumentSrc(base64Value, mimeType) {
      const value = String(base64Value || "").trim();
      if (!value) {
        return "";
      }
      if (value.startsWith("data:")) {
        return value;
      }
      const mime = String(mimeType || "application/octet-stream").trim() || "application/octet-stream";
      return `data:${mime};base64,${value}`;
    }

    function decodeDataUrlText(dataUrl, maxChars = 120000) {
      const value = String(dataUrl || "").trim();
      if (!value.startsWith("data:")) {
        return "";
      }

      const comma = value.indexOf(",");
      if (comma < 0) {
        return "";
      }

      const meta = value.slice(0, comma);
      const body = value.slice(comma + 1);
      let text = "";

      if (meta.includes(";base64")) {
        const binary = atob(body);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        text = new TextDecoder("utf-8").decode(bytes);
      } else {
        text = decodeURIComponent(body);
      }

      if (text.length > maxChars) {
        return `${text.slice(0, maxChars)}\n\n[Preview truncated]`;
      }

      return text;
    }

    function isAudioMediaItem(item) {
      const mime = String(item?.mimeType || "").toLowerCase();
      const name = String(item?.filename || item?.label || "");
      return (
        mime.startsWith("audio/") ||
        /\.(wav|wave|mp3|m4a|ogg|flac|aac|weba|aiff?|mid|midi)$/i.test(name)
      );
    }

    function attachmentPlaceholderLabel(item) {
      const name = String(item.filename || item.label || "").trim();
      if (name) {
        return name;
      }
      if (isDocumentMediaItem(item)) {
        return "Document attachment";
      }
      if (isAudioMediaItem(item)) {
        return "Audio attachment";
      }
      return "Video attachment";
    }

    function isDocumentMediaItem(item) {
      const kind = String(item?.captureKind || "");
      const mime = String(item?.mimeType || "").toLowerCase();
      const name = String(item?.filename || item?.label || "");
      return (
        kind.includes("document") ||
        mime === "application/pdf" ||
        mime.startsWith("text/") ||
        mime.startsWith("audio/") ||
        mime === "application/json" ||
        /\.(pdf|docx?|xlsx?|pptx?|txt|csv|json|md|markdown|rtf|odt|ods|zip|html?|xml|yaml|yml|wav|wave|mp3|m4a|ogg|flac|aac|weba|aiff?|mid|midi)$/i.test(
          name
        )
      );
    }

    function appendDocumentPreview(wrap, item) {
      const filename = String(item.filename || item.label || "document").trim() || "document";
      const mimeType = String(item.mimeType || "").toLowerCase();
      const src = normalizeDocumentSrc(item.base64, item.mimeType);
      const figure = document.createElement("figure");
      figure.className = "inline-document";

      const caption = document.createElement("div");
      caption.className = "document-caption";
      caption.textContent = filename;
      figure.appendChild(caption);

      if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) {
        const iframe = document.createElement("iframe");
        iframe.className = "document-preview-frame";
        iframe.src = src;
        iframe.title = filename;
        figure.appendChild(iframe);
        wrap.appendChild(figure);
        return;
      }

      if (
        item.captureKind === "document-image-preview" ||
        (mimeType.startsWith("image/") && src)
      ) {
        const img = document.createElement("img");
        img.className = "document-image-preview";
        img.src = src.startsWith("data:") ? src : normalizeImageSrc(src);
        img.alt = filename;
        img.loading = "lazy";
        figure.appendChild(img);
        wrap.appendChild(figure);
        return;
      }

      const isTextLike =
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        /\.(txt|csv|json|md|markdown|yaml|yml|xml|html?)$/i.test(filename);

      if (isTextLike) {
        const pre = document.createElement("pre");
        pre.className = "document-text-preview";
        pre.textContent = decodeDataUrlText(src) || "[Empty text document]";
        figure.appendChild(pre);
        wrap.appendChild(figure);
        return;
      }

      const link = document.createElement("a");
      link.className = "document-download-link";
      link.href = src;
      link.download = filename;
      link.textContent = `Download ${filename}`;
      figure.appendChild(link);
      wrap.appendChild(figure);
    }

    function appendContextRow(container, label, value) {
      if (value == null || value === "") {
        return;
      }

      const row = document.createElement("div");
      row.className = "meta-row";

      const labelEl = document.createElement("div");
      labelEl.className = "meta-label";
      labelEl.textContent = label;

      const valueEl = document.createElement("div");
      valueEl.className = "meta-value";
      valueEl.textContent = String(value);

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      container.appendChild(row);
    }

    function renderSessionContext(sessionData) {
      const panel = document.getElementById("session-context-panel");
      const grid = document.getElementById("session-context-grid");
      const summaryEl = document.getElementById("audit-summary");
      const unexposedPanel = document.getElementById("audit-unexposed-panel");
      const unexposedList = document.getElementById("audit-unexposed-list");
      const timelinePanel = document.getElementById("audit-timeline-panel");
      const timelineEl = document.getElementById("audit-timeline");

      grid.innerHTML = "";
      summaryEl.textContent = "";
      summaryEl.classList.add("hidden");
      unexposedList.innerHTML = "";
      timelineEl.innerHTML = "";

      const audit = sessionData?.auditRecord;
      const ctx = sessionData?.sessionContext;
      const tab = sessionData?.captureTab;
      const signOff = audit?.signOffContext || sessionData?.signOffContext;

      if (!ctx && !tab && !audit) {
        panel.classList.add("hidden");
        unexposedPanel.classList.add("hidden");
        timelinePanel.classList.add("hidden");
        return;
      }

      const auditSession = audit?.sessionContext || {};
      const page = ctx?.page || {};
      const env = audit?.environmentTelemetry || ctx?.environment || {};
      const platform = ctx?.platform || {};
      const interaction = ctx?.interaction || {};
      const attachments = interaction.attachments || {};
      const unexposed = audit?.unexposedMediaManifest || {};

      if (audit?.interactionSummary) {
        summaryEl.textContent = audit.interactionSummary;
        summaryEl.classList.remove("hidden");
      }

      appendContextRow(
        grid,
        "Captured at",
        env.capturedAt || audit?.recordedAt || tab?.capturedAt
      );
      appendContextRow(grid, "Signed off at", signOff?.anchoredAt);
      appendContextRow(grid, "Time zone", env.timeZone);
      appendContextRow(
        grid,
        "UTC offset (min)",
        env.localTimezoneOffsetMinutes
      );
      appendContextRow(grid, "Screen", env.screenResolution);
      appendContextRow(grid, "Page URL", auditSession.sessionUrl || tab?.url || page.url);
      appendContextRow(grid, "Conversation ID", auditSession.conversationId || page.conversationId);
      appendContextRow(
        grid,
        "Session title",
        auditSession.sessionTitle || tab?.title || page.title
      );
      appendContextRow(grid, "Model", auditSession.scrapedModel || platform.modelName);
      appendContextRow(grid, "Custom GPT", auditSession.customGptName || platform.customGptName);
      appendContextRow(grid, "Project", auditSession.projectName || platform.projectName);
      appendContextRow(
        grid,
        "Messages",
        auditSession.turnCount != null
          ? `${auditSession.userTurnCount ?? 0} user · ${auditSession.assistantTurnCount ?? 0} assistant · ${auditSession.turnCount} total`
          : null
      );
      appendContextRow(
        grid,
        "Scroll audit",
        auditSession.scrollPasses != null
          ? `${auditSession.scrollPasses} pass(es) · ${auditSession.viewportCheckpointsPerPass ?? 5} checkpoints/pass`
          : null
      );
      appendContextRow(
        grid,
        "Attachments",
        attachments.documents || attachments.images || attachments.videos
          ? `docs ${attachments.documents?.referenced ?? 0} (${attachments.documents?.captured ?? 0} captured) · ` +
            `images ${attachments.images?.referenced ?? 0} · videos ${attachments.videos?.referenced ?? 0}`
          : null
      );
      appendContextRow(grid, "Identity proof", signOff?.identityProofAddress);
      appendContextRow(
        grid,
        "Viewport",
        env.viewport
          ? `${env.viewport.width}×${env.viewport.height} @${env.viewport.devicePixelRatio}x`
          : null
      );

      const features = auditSession.sessionFeatures || platform.visibleFeatures;
      if (Array.isArray(features) && features.length) {
        const row = document.createElement("div");
        row.className = "meta-row";

        const labelEl = document.createElement("div");
        labelEl.className = "meta-label";
        labelEl.textContent = "Session features";

        const valueEl = document.createElement("div");
        valueEl.className = "meta-value";
        const chips = document.createElement("div");
        chips.className = "context-chip-list";
        features.forEach((feature) => {
          const chip = document.createElement("span");
          chip.className = "context-chip";
          chip.textContent = feature;
          chips.appendChild(chip);
        });
        valueEl.appendChild(chips);

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        grid.appendChild(row);
      }

      panel.classList.toggle("hidden", grid.children.length === 0 && summaryEl.classList.contains("hidden"));

      const unexposedItems = [
        ...safeArray(unexposed.missingPdfs).map((name) => `[PDF] ${name}`),
        ...safeArray(unexposed.missingAudio).map((name) => `[Audio] ${name}`),
        ...safeArray(unexposed.missingVideo).map((name) => `[Video] ${name}`),
        ...safeArray(unexposed.missingDocuments).map((name) => `[File] ${name}`),
      ];

      unexposedItems.forEach((label) => {
        const item = document.createElement("li");
        item.textContent = label;
        unexposedList.appendChild(item);
      });
      unexposedPanel.classList.toggle("hidden", unexposedItems.length === 0);

      safeArray(audit?.interactionTimeline).forEach((event) => {
        const item = document.createElement("li");
        if (String(event.type || "").includes("unexposed")) {
          item.className = "audit-unexposed";
        }

        const type = document.createElement("span");
        type.className = "audit-timeline-type";
        type.textContent = String(event.type || "event").replace(/-/g, " ");

        item.appendChild(type);
        item.appendChild(document.createTextNode(event.summary || ""));
        timelineEl.appendChild(item);
      });
      timelinePanel.classList.toggle(
        "hidden",
        !audit?.interactionTimeline || audit.interactionTimeline.length === 0
      );
    }

    function safeArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function appendCapturedVideo(container, sessionData) {
      const capturedVideo = sessionData?.capturedVideo;
      if (!capturedVideo) {
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "session-video";

      const label = document.createElement("div");
      label.className = "session-video-label";
      label.textContent = "Tab recording";

      const video = document.createElement("video");
      video.className = "session-video-player";
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = normalizeVideoSrc(capturedVideo, sessionData.capturedVideoMime);

      wrap.appendChild(label);
      wrap.appendChild(video);
      container.appendChild(wrap);
    }

    function renderConversation(sessionData) {
      if (!sessionData || typeof sessionData !== "object") {
        showError("Decrypted payload was empty or malformed.");
        return;
      }

      const messages = [...(Array.isArray(sessionData.conversation) ? sessionData.conversation : [])]
        .sort((left, right) => (Number(left.index) || 0) - (Number(right.index) || 0));
      const sessionImages = Array.isArray(sessionData.sessionImages)
        ? sessionData.sessionImages
        : [];
      const sessionVideos = Array.isArray(sessionData.sessionVideos)
        ? sessionData.sessionVideos
        : [];
      const sessionDocuments = Array.isArray(sessionData.sessionDocuments)
        ? sessionData.sessionDocuments
        : [];
      const linkedImageIndexes = new Set(
        sessionDocuments
          .map((document) => Number(document?.relatedImageIndex))
          .filter((index) => Number.isFinite(index) && index > 0)
      );
      const successfulImages = sessionImages.filter(
        (image) =>
          image?.captureStatus === "success" &&
          image?.base64 &&
          !linkedImageIndexes.has(Number(image.index))
      );
      const successfulVideos = sessionVideos.filter(
        (video) =>
          (video?.captureStatus === "success" && video?.base64) ||
          video?.captureStatus === "metadata-only"
      );
      const successfulDocuments = collapseEquivalentDocuments(
        sessionDocuments.filter(
          (document) =>
            (document?.captureStatus === "success" && document?.base64) ||
            document?.captureStatus === "metadata-only"
        )
      );
      const successfulMedia = dedupeMetadataOnlyByFilename(
        [...successfulImages, ...successfulVideos, ...successfulDocuments].sort(
          (left, right) =>
            (Number(left.afterMessageIndex) || 0) - (Number(right.afterMessageIndex) || 0)
        )
      );
      const mediaByMessage = buildMediaByMessageIndex(messages, successfulMedia);
      const capturedVideo = sessionData.capturedVideo;
      const chatLog = document.getElementById("chat-log");
      chatLog.innerHTML = "";

      if (!messages.length && !successfulMedia.length && !capturedVideo) {
        showError("Decrypted successfully, but no conversation messages were found.");
        return;
      }

      const platform = sessionData.sourcePlatform || loadedSession?.sourcePlatform || "unknown";
      const platformLabels = {
        chatgpt: "ChatGPT",
        gemini: "Gemini",
        claude: "Claude",
        grok: "Grok",
        "x-grok": "Grok on X",
        perplexity: "Perplexity",
        copilot: "Microsoft Copilot",
        poe: "Poe",
        "meta-ai": "Meta AI",
        deepseek: "DeepSeek",
        mistral: "Mistral",
        you: "You.com",
        pi: "Pi",
        character: "Character.AI",
        huggingface: "HuggingChat",
      };
      const platformLabel = platformLabels[platform] || platform;
      document.getElementById("chat-meta").textContent =
        `${messages.length} messages · ${platformLabel}` +
        (successfulDocuments.length
          ? ` · ${successfulDocuments.length} document(s)`
          : "") +
        (successfulVideos.length ? ` · ${successfulVideos.length} chat video(s)` : "") +
        (capturedVideo ? " · tab video" : "") +
        (loadedSession?.timestamp ? ` · anchored ${loadedSession.timestamp}` : "");

      renderSessionContext(sessionData);

      messages.forEach((message) => {
        const media = mediaByMessage.get(message.index) || [];
        appendMessageBubble(chatLog, message, { hasMedia: media.length > 0 });

        if (media.length) {
          appendInlineMedia(chatLog, media, normalizeRole(message.role));
        }
      });

      appendCapturedVideo(chatLog, sessionData);

      if (messages.length || successfulMedia.length || capturedVideo) {
        chatPanel.classList.remove("hidden");
      } else {
        chatPanel.classList.add("hidden");
      }

      clearError();
    }

    dropzone.addEventListener("click", () => openArchivePicker());

    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove("dragover");
      logStep("Drop on viewer zone");
      if (!event.dataTransfer?.files?.length) {
        logStep("Drop had no files");
        return;
      }
      processIncomingFiles(event.dataTransfer.files).catch((error) => {
        logStep(`Error: ${error.message}`);
        showError(error.message);
      });
    });

    fileInput.addEventListener("change", (event) => {
      const files = event.target.files;
      logStep(`File input change: ${files?.length || 0} file(s)`);
      if (!files?.length) {
        logStep("File input returned empty");
        return;
      }
      processIncomingFiles(files).catch((error) => {
        logStep(`Error: ${error.message}`);
        showError(error.message);
      });
      fileInput.value = "";
    });

    decryptButton.addEventListener("click", handleDecrypt);

    async function readPendingViewerFiles() {
      if (chrome.storage?.session) {
        const sessionStored = await new Promise((resolve) => {
          chrome.storage.session.get("viewerPendingFiles", resolve);
        });
        if (sessionStored?.viewerPendingFiles?.ninkText) {
          return sessionStored.viewerPendingFiles;
        }
      }

      const localStored = await new Promise((resolve) => {
        chrome.storage.local.get("viewerPendingFiles", resolve);
      });
      const legacy = localStored?.viewerPendingFiles;
      if (!legacy?.ninkText) {
        return null;
      }

      await chrome.storage.local.remove("viewerPendingFiles");
      const migrated = { ...legacy };
      if (cloudUnlockRequiredForNinkText(migrated.ninkText)) {
        delete migrated.keyText;
        delete migrated.keyFilename;
      }
      if (chrome.storage?.session) {
        await chrome.storage.session.set({ viewerPendingFiles: migrated });
      }
      return migrated;
    }

    function cloudUnlockRequiredForNinkText(ninkText) {
      let session = null;
      try {
        session = JSON.parse(ninkText);
      } catch (_error) {
        return false;
      }
      const helpers = strictCloudHelpers();
      if (helpers.requiresCloudUnlock) {
        return helpers.requiresCloudUnlock(session, ninkConfig);
      }
      return Boolean(session?.packageId);
    }

    async function clearPendingViewerFiles() {
      if (chrome.storage?.session) {
        await new Promise((resolve) => {
          chrome.storage.session.remove("viewerPendingFiles", resolve);
        });
      }
      await new Promise((resolve) => {
        chrome.storage.local.remove("viewerPendingFiles", resolve);
      });
    }

    async function loadPendingFromSignOff() {
      if (String(location.protocol || "").toLowerCase() !== "chrome-extension:") {
        logStep("Not extension page — use extension Open Viewer");
        return;
      }
      if (!chrome?.storage?.session && !chrome?.storage?.local) {
        logStep("chrome.storage unavailable");
        return;
      }

      await loadNinkConfig();
      const pending = await readPendingViewerFiles();
      if (!pending?.ninkText) {
        logStep("No sign-off session in memory — pick .nink (+ .ninkkey for local-only) below");
        return;
      }

      logStep("Loading session from extension session memory…");
      loadedNinkFileName = pending.ninkFilename || "session.nink";
      if (!loadSessionFromText(pending.ninkText)) {
        return;
      }

      if (pending.keyText && !cloudUnlockRequired()) {
        pendingKey = {
          keyText: pending.keyText,
          fileName: pending.keyFilename || getKeyFileName(loadedNinkFileName),
          meta: null,
        };
        applyPendingKey("Loaded from sign-off", true);
      } else if (cloudUnlockRequired()) {
        setKeyStatus(
          "Cloud-backed package loaded — paid Cloud unlock required (key not stored).",
          false
        );
        updatePackageModeBanner();
        globalThis.__NINK_refreshCloudPanel__?.();
      }

      await clearPendingViewerFiles();
      logStep("Sign-off session loaded");
    }

    loadNinkConfig().then(loadPendingFromSignOff);

    globalThis.__NINK_viewer__ = {
      getLoadedSession: () => loadedSession,
      getLoadedSecretKey: () => loadedSecretKey,
      cloudUnlockRequired: () => cloudUnlockRequired(),
      getNinkConfig: () => ({ ...ninkConfig }),
      renderConversation,
      clearError,
      showError,
      logStep,
    };
  