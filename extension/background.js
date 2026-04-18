const DEFAULT_SETTINGS = {
  hostName: "com.suttikeat.chatgpt_obsidian_sync",
  targetFolder: "chatgpt",
  dryRunOnNativeFailure: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    handleGetSettings().then(sendResponse);
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    handleSaveSettings(message.payload).then(sendResponse);
    return true;
  }

  if (message?.type === "GET_SYNC_METADATA") {
    handleGetSyncMetadata(message.conversationIds || []).then(sendResponse);
    return true;
  }

  if (message?.type === "SYNC_CONVERSATIONS") {
    handleSyncConversations(message.payload).then(sendResponse);
    return true;
  }

  return false;
});

async function handleGetSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ok: true, settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } };
}

async function handleSaveSettings(nextSettings) {
  const merged = {
    ...(await handleGetSettings()).settings,
    ...nextSettings
  };
  await chrome.storage.local.set({ settings: merged });
  return { ok: true, settings: merged };
}

async function handleGetSyncMetadata(conversationIds) {
  const { syncMetadata = {} } = await chrome.storage.local.get("syncMetadata");
  const selected = {};
  for (const conversationId of conversationIds) {
    selected[conversationId] = syncMetadata[conversationId] || null;
  }
  return { ok: true, syncMetadata: selected };
}

async function handleSyncConversations(payload) {
  const settings = (await handleGetSettings()).settings;
  const conversations = (payload?.conversations || []).map((conversation) => ({
    ...conversation,
    targetFolder: payload?.targetFolder || settings.targetFolder || "chatgpt",
    contentHash: computeConversationHash(conversation)
  }));

  if (!conversations.length) {
    return { ok: false, error: "No conversations were provided." };
  }

  const nativeRequest = {
    type: "syncConversations",
    settings: {
      targetFolder: payload?.targetFolder || settings.targetFolder || "chatgpt"
    },
    conversations
  };

  try {
    const response = await sendNativeMessage(settings.hostName, nativeRequest);
    if (!response?.ok) {
      throw new Error(response?.error || "Native helper returned an error.");
    }

    await updateSyncMetadata(response.results || [], conversations);

    return {
      ok: true,
      mode: "native",
      results: response.results || []
    };
  } catch (error) {
    const fallbackPayloads = conversations.map((conversation) => ({
      conversationId: conversation.conversationId,
      title: conversation.title,
      filename: buildConversationFilename(conversation),
      markdown: renderConversationMarkdown(conversation)
    }));

    if (settings.dryRunOnNativeFailure) {
      return {
        ok: false,
        mode: "fallback",
        error: error.message,
        fallbackPayloads
      };
    }

    return {
      ok: false,
      mode: "native",
      error: error.message
    };
  }
}

async function updateSyncMetadata(results, conversations) {
  const lookup = new Map(conversations.map((conversation) => [conversation.conversationId, conversation]));
  const { syncMetadata = {} } = await chrome.storage.local.get("syncMetadata");

  for (const result of results) {
    if (!result?.conversationId) {
      continue;
    }
    const conversation = lookup.get(result.conversationId);
    syncMetadata[result.conversationId] = {
      status: result.status,
      title: conversation?.title || result.title || "Untitled conversation",
      contentHash: conversation?.contentHash || null,
      filePath: result.filePath || null,
      syncedAt: result.syncedAt || new Date().toISOString(),
      error: result.error || null
    };
  }

  await chrome.storage.local.set({ syncMetadata });
}

function sendNativeMessage(hostName, request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(hostName, request, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function computeConversationHash(conversation) {
  const raw = JSON.stringify({
    conversationId: conversation.conversationId,
    title: conversation.title,
    messages: (conversation.messages || []).map((message) => ({
      role: message.role,
      contentMarkdown: message.contentMarkdown,
      createdAt: message.createdAt || null
    }))
  });

  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildConversationFilename(conversation) {
  const slug = slugify(conversation.title || "conversation");
  return `${slug}--${conversation.conversationId}.md`;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "conversation";
}

function renderConversationMarkdown(conversation) {
  const transcript = (conversation.messages || [])
    .map((message) => {
      const roleLabel = roleToLabel(message.role);
      const content = message.contentMarkdown?.trim() || "_No content extracted._";
      return `### ${roleLabel}\n${content}`;
    })
    .join("\n\n");

  const lastMessageAt = findLastMessageTimestamp(conversation.messages);

  return [
    "---",
    `source: chatgpt`,
    `conversation_id: ${yamlQuote(conversation.conversationId)}`,
    `title: ${yamlQuote(conversation.title || "Untitled conversation")}`,
    `source_url: ${yamlQuote(conversation.url || "")}`,
    `synced_at: ${yamlQuote(conversation.syncedAt || new Date().toISOString())}`,
    `last_message_at: ${yamlQuote(lastMessageAt || "")}`,
    `message_count: ${Array.isArray(conversation.messages) ? conversation.messages.length : 0}`,
    `content_hash: ${yamlQuote(conversation.contentHash || computeConversationHash(conversation))}`,
    "tags:",
    "  - ai/chatgpt",
    "  - inbox",
    "---",
    "",
    `# ${conversation.title || "Untitled conversation"}`,
    "",
    "## Summary",
    "Optional placeholder for later manual note-taking or future auto-summary.",
    "",
    "## Transcript",
    transcript || "_No messages extracted._",
    "",
    "## Metadata",
    "- Source: ChatGPT",
    `- Conversation ID: \`${conversation.conversationId}\``,
    `- Synced: \`${conversation.syncedAt || new Date().toISOString()}\``
  ].join("\n");
}

function roleToLabel(role) {
  switch (role) {
    case "assistant":
      return "ChatGPT";
    case "system":
      return "System";
    default:
      return "User";
  }
}

function yamlQuote(value) {
  return JSON.stringify(String(value || ""));
}

function findLastMessageTimestamp(messages) {
  const createdAtValues = (messages || [])
    .map((message) => message.createdAt)
    .filter(Boolean)
    .sort();
  return createdAtValues[createdAtValues.length - 1] || null;
}
