(function bootstrapContentScript() {
  const CHAT_PATH_PATTERN = /\/c\/([a-zA-Z0-9-]+)/;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LIST_CONVERSATIONS") {
      listVisibleConversations().then(sendResponse);
      return true;
    }

    if (message?.type === "EXTRACT_CONVERSATIONS") {
      extractConversations(message.conversationIds || []).then(sendResponse);
      return true;
    }

    return false;
  });

  async function listVisibleConversations() {
    const conversationMap = new Map();
    const links = Array.from(document.querySelectorAll("a[href*='/c/']"));

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(CHAT_PATH_PATTERN);
      if (!match) {
        continue;
      }

      const conversationId = match[1];
      const title = extractConversationTitle(link);
      conversationMap.set(conversationId, {
        conversationId,
        title: title || `Conversation ${conversationId.slice(0, 8)}`,
        url: new URL(href, window.location.origin).toString(),
        isCurrent: getCurrentConversationId() === conversationId
      });
    }

    const currentConversationId = getCurrentConversationId();
    if (currentConversationId && !conversationMap.has(currentConversationId)) {
      conversationMap.set(currentConversationId, {
        conversationId: currentConversationId,
        title: document.title.replace(/\s+\|\s+ChatGPT$/, "") || `Conversation ${currentConversationId.slice(0, 8)}`,
        url: window.location.href,
        isCurrent: true
      });
    }

    const conversations = Array.from(conversationMap.values()).sort((left, right) => {
      if (left.isCurrent && !right.isCurrent) {
        return -1;
      }
      if (!left.isCurrent && right.isCurrent) {
        return 1;
      }
      return left.title.localeCompare(right.title);
    });

    return { ok: true, conversations };
  }

  async function extractConversations(conversationIds) {
    const visible = await listVisibleConversations();
    const lookup = new Map((visible.conversations || []).map((conversation) => [conversation.conversationId, conversation]));
    const results = [];
    const errors = [];

    for (const conversationId of conversationIds) {
      const fallbackConversation = lookup.get(conversationId) || null;
      try {
        const conversation = await fetchConversation(conversationId, fallbackConversation);
        results.push(conversation);
      } catch (error) {
        errors.push({
          conversationId,
          title: fallbackConversation?.title || "Unknown conversation",
          error: error.message
        });
      }
    }

    return { ok: errors.length === 0, conversations: results, errors };
  }

  async function fetchConversation(conversationId, fallbackConversation) {
    try {
      const response = await fetch(`/backend-api/conversation/${conversationId}`, {
        credentials: "include",
        headers: {
          "accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`ChatGPT API returned ${response.status}.`);
      }

      const payload = await response.json();
      const normalized = normalizeConversationFromApi(payload, fallbackConversation);
      if (getCurrentConversationId() === conversationId) {
        return augmentConversationWithDomCanvasArtifacts(normalized);
      }
      return normalized;
    } catch (error) {
      if (getCurrentConversationId() === conversationId) {
        return normalizeCurrentConversationFromDom(fallbackConversation, error);
      }
      throw error;
    }
  }

  function normalizeConversationFromApi(payload, fallbackConversation) {
    const mapping = payload?.mapping || {};
    const orderedNodes = Object.values(mapping)
      .filter((node) => node?.message?.author?.role && !isSystemMetadataMessage(node.message))
      .sort((left, right) => (left.message?.create_time || 0) - (right.message?.create_time || 0));

    const messages = orderedNodes
      .map((node) => normalizeApiMessage(node.message))
      .filter((message) => message.contentMarkdown.trim().length > 0);

    return {
      source: "chatgpt",
      conversationId: payload?.conversation_id || fallbackConversation?.conversationId,
      title: payload?.title || fallbackConversation?.title || document.title.replace(/\s+\|\s+ChatGPT$/, ""),
      url: buildConversationUrl(payload?.conversation_id || fallbackConversation?.conversationId),
      syncedAt: new Date().toISOString(),
      lastModifiedAt: isoFromUnixSeconds(payload?.update_time),
      messages
    };
  }

  function normalizeApiMessage(message) {
    const role = message?.author?.role || "user";
    const parts = extractParts(message?.content);
    return {
      role,
      contentMarkdown: parts.join("\n\n").trim(),
      createdAt: isoFromUnixSeconds(message?.create_time)
    };
  }

  function extractParts(content) {
    if (!content) {
      return [];
    }

    if (Array.isArray(content.parts)) {
      return content.parts.map(partToMarkdown).filter(Boolean);
    }

    if (typeof content.text === "string") {
      return [content.text];
    }

    if (typeof content.result === "string") {
      return [content.result];
    }

    if (typeof content === "string") {
      return [content];
    }

    return [];
  }

  function partToMarkdown(part) {
    if (typeof part === "string") {
      return part;
    }

    if (Array.isArray(part)) {
      return part.map(partToMarkdown).filter(Boolean).join("\n");
    }

    if (typeof part?.text === "string") {
      return String(part.text);
    }

    if (typeof part?.content === "string") {
      return String(part.content);
    }

    const codePayload = part?.text || part?.code || part?.content;
    if ((part?.type === "code" || part?.language) && typeof codePayload === "string") {
      const language = part.language || part.mimeType || "";
      return `\`\`\`${normalizeLanguage(language)}\n${codePayload}\n\`\`\``;
    }

    if (part?.textdoc && typeof part.textdoc === "string") {
      const language = normalizeLanguage(part?.language || part?.format || "");
      return `\`\`\`${language}\n${part.textdoc}\n\`\`\``;
    }

    if (typeof part?.value === "string" && /code|textdoc|artifact/i.test(String(part?.type || part?.kind || ""))) {
      const language = normalizeLanguage(part?.language || part?.format || "");
      return `\`\`\`${language}\n${part.value}\n\`\`\``;
    }

    try {
      return JSON.stringify(part, null, 2);
    } catch (_error) {
      return "";
    }
  }

  function normalizeCurrentConversationFromDom(fallbackConversation, originalError) {
    const messageNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    if (!messageNodes.length) {
      throw new Error(`DOM fallback failed: ${originalError.message}`);
    }

    const messages = messageNodes.map((node) => ({
      role: node.getAttribute("data-message-author-role") || "user",
      contentMarkdown: extractMarkdownFromNode(node).trim(),
      createdAt: null
    }));

    return {
      source: "chatgpt",
      conversationId: getCurrentConversationId(),
      title: fallbackConversation?.title || document.title.replace(/\s+\|\s+ChatGPT$/, ""),
      url: window.location.href,
      syncedAt: new Date().toISOString(),
      lastModifiedAt: null,
      messages
    };
  }

  function extractMarkdownFromNode(node) {
    const clone = node.cloneNode(true);
    const canvasBlocks = extractCanvasBlocksFromNode(clone);
    for (const canvasNode of clone.querySelectorAll(".cm-editor, .cm-content[data-language]")) {
      canvasNode.remove();
    }
    const text = [];

    const blocks = clone.querySelectorAll("pre, li, p, h1, h2, h3, h4, h5, h6, blockquote");
    if (blocks.length === 0) {
      const fallbackText = normalizePlainText(clone.textContent || "");
      return [fallbackText, ...canvasBlocks].filter(Boolean).join("\n\n");
    }

    for (const block of blocks) {
      if (block.matches("pre")) {
        const codeNode = block.querySelector("code");
        const languageClass = codeNode?.className || "";
        const languageMatch = languageClass.match(/language-([a-zA-Z0-9_-]+)/);
        const language = languageMatch ? languageMatch[1] : "";
        text.push(`\`\`\`${language}\n${codeNode?.textContent || block.textContent || ""}\n\`\`\``);
        continue;
      }

      if (block.matches("blockquote")) {
        const quoteText = (block.textContent || "")
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        text.push(quoteText);
        continue;
      }

      if (block.matches("li")) {
        text.push(`- ${block.textContent || ""}`);
        continue;
      }

      text.push(block.textContent || "");
    }

    return [...text, ...canvasBlocks].filter(Boolean).join("\n\n");
  }

  function augmentConversationWithDomCanvasArtifacts(conversation) {
    const domArtifacts = extractCanvasArtifactsFromConversationDom();
    if (!domArtifacts.length) {
      return conversation;
    }

    const roleCounts = new Map();
    const messages = (conversation.messages || []).map((message) => ({ ...message }));

    for (const artifact of domArtifacts) {
      const nextOccurrence = (roleCounts.get(artifact.role) || 0) + 1;
      roleCounts.set(artifact.role, nextOccurrence);
      const messageIndex = findNthMessageIndex(messages, artifact.role, nextOccurrence);
      if (messageIndex === -1) {
        continue;
      }

      const artifactMarkdown = artifact.blocks.join("\n\n").trim();
      if (!artifactMarkdown) {
        continue;
      }

      const currentContent = messages[messageIndex].contentMarkdown || "";
      if (!currentContent.includes(artifactMarkdown)) {
        messages[messageIndex].contentMarkdown = [currentContent.trim(), artifactMarkdown]
          .filter(Boolean)
          .join("\n\n");
      }
    }

    return {
      ...conversation,
      messages
    };
  }

  function extractCanvasArtifactsFromConversationDom() {
    const messageNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    return messageNodes
      .map((node) => ({
        role: node.getAttribute("data-message-author-role") || "user",
        blocks: extractCanvasBlocksFromNode(node)
      }))
      .filter((artifact) => artifact.blocks.length > 0);
  }

  function extractCanvasBlocksFromNode(node) {
    const codeBlocks = [];
    const canvases = node.matches?.(".cm-content[data-language]")
      ? [node]
      : Array.from(node.querySelectorAll(".cm-content[data-language]"));

    for (const canvas of canvases) {
      const language = normalizeLanguage(canvas.getAttribute("data-language") || "");
      const lineNodes = Array.from(canvas.querySelectorAll(":scope > .cm-line"));
      const lines = lineNodes.map((line) => {
        const text = line.textContent || "";
        if (!text.trim() && line.querySelector("br")) {
          return "";
        }
        return text;
      });
      const code = lines.join("\n").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trimEnd();
      if (code.trim()) {
        codeBlocks.push(`\`\`\`${language}\n${code}\n\`\`\``);
      }
    }

    return codeBlocks;
  }

  function findNthMessageIndex(messages, role, occurrence) {
    let count = 0;
    for (let index = 0; index < messages.length; index += 1) {
      if ((messages[index].role || "user") === role) {
        count += 1;
        if (count === occurrence) {
          return index;
        }
      }
    }
    return -1;
  }

  function normalizePlainText(value) {
    return String(value || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeLanguage(value) {
    return String(value || "").replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
  }

  function extractConversationTitle(link) {
    const richText = link.querySelector("[dir='auto']");
    if (richText?.textContent?.trim()) {
      return richText.textContent.trim();
    }
    return link.textContent?.trim() || "";
  }

  function getCurrentConversationId() {
    const match = window.location.pathname.match(CHAT_PATH_PATTERN);
    return match ? match[1] : null;
  }

  function buildConversationUrl(conversationId) {
    return new URL(`/c/${conversationId}`, window.location.origin).toString();
  }

  function isoFromUnixSeconds(value) {
    if (!value) {
      return null;
    }
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  function isSystemMetadataMessage(message) {
    const role = message?.author?.role;
    const metadata = message?.metadata || {};
    return role === "tool" || Boolean(metadata?.is_visually_hidden_from_conversation);
  }
})();
