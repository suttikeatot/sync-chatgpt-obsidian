const state = {
  conversations: [],
  metadata: {},
  settings: null
};

const elements = {
  refreshButton: document.getElementById("refreshButton"),
  selectCurrentButton: document.getElementById("selectCurrentButton"),
  selectAllButton: document.getElementById("selectAllButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  syncButton: document.getElementById("syncButton"),
  chatList: document.getElementById("chatList"),
  statusBanner: document.getElementById("statusBanner"),
  targetFolderInput: document.getElementById("targetFolderInput"),
  hostNameInput: document.getElementById("hostNameInput"),
  resultPanel: document.getElementById("resultPanel")
};

bootstrap().catch((error) => {
  showBanner(error.message, true);
});

elements.refreshButton.addEventListener("click", () => loadConversations());
elements.selectCurrentButton.addEventListener("click", () => selectConversations((conversation) => conversation.isCurrent));
elements.selectAllButton.addEventListener("click", () => selectConversations(() => true));
elements.saveSettingsButton.addEventListener("click", () => saveSettings());
elements.syncButton.addEventListener("click", () => syncSelectedConversations());

async function bootstrap() {
  const settingsResponse = await sendRuntimeMessage({ type: "GET_SETTINGS" });
  state.settings = settingsResponse.settings;
  elements.targetFolderInput.value = state.settings.targetFolder || "chatgpt";
  elements.hostNameInput.value = state.settings.hostName || "com.suttikeat.chatgpt_obsidian_sync";
  await loadConversations();
}

async function loadConversations() {
  hideResults();
  showBanner("Scanning the current ChatGPT page...", false);

  const tab = await getActiveTab();
  if (!tab?.id || !isSupportedChatGptUrl(tab.url)) {
    state.conversations = [];
    renderConversationList();
    showBanner("Open a ChatGPT conversation tab first, then refresh.", true);
    return;
  }

  const listResponse = await sendTabMessage(tab.id, { type: "LIST_CONVERSATIONS" });
  if (!listResponse?.ok) {
    throw new Error(listResponse?.error || "Could not read conversations from the ChatGPT tab.");
  }

  state.conversations = (listResponse.conversations || []).map((conversation) => ({
    ...conversation,
    selected: conversation.isCurrent
  }));

  const metadataResponse = await sendRuntimeMessage({
    type: "GET_SYNC_METADATA",
    conversationIds: state.conversations.map((conversation) => conversation.conversationId)
  });
  state.metadata = metadataResponse.syncMetadata || {};

  renderConversationList();
  showBanner(`Found ${state.conversations.length} visible conversation(s).`, false);
}

function renderConversationList() {
  if (!state.conversations.length) {
    elements.chatList.innerHTML = `<div class="result-card error">No visible conversations were detected in the current ChatGPT sidebar.</div>`;
    return;
  }

  elements.chatList.innerHTML = "";

  for (const conversation of state.conversations) {
    const item = document.createElement("label");
    const metadata = state.metadata[conversation.conversationId];
    const status = deriveStatusBadge(metadata);
    item.className = `chat-item${conversation.isCurrent ? " current" : ""}`;
    item.innerHTML = `
      <input type="checkbox" data-conversation-id="${conversation.conversationId}" ${conversation.selected ? "checked" : ""}>
      <div>
        <div class="chat-title">${escapeHtml(conversation.title)}</div>
        <div class="chat-meta">${conversation.isCurrent ? "Current chat" : "Visible in sidebar"}</div>
      </div>
      <span class="badge ${status.className}">${status.label}</span>
    `;
    elements.chatList.appendChild(item);
  }

  for (const checkbox of elements.chatList.querySelectorAll("input[type='checkbox']")) {
    checkbox.addEventListener("change", (event) => {
      const conversationId = event.target.getAttribute("data-conversation-id");
      const conversation = state.conversations.find((entry) => entry.conversationId === conversationId);
      if (conversation) {
        conversation.selected = event.target.checked;
      }
    });
  }
}

function selectConversations(predicate) {
  state.conversations = state.conversations.map((conversation) => ({
    ...conversation,
    selected: predicate(conversation)
  }));
  renderConversationList();
}

async function saveSettings() {
  const response = await sendRuntimeMessage({
    type: "SAVE_SETTINGS",
    payload: {
      targetFolder: elements.targetFolderInput.value.trim() || "chatgpt",
      hostName: elements.hostNameInput.value.trim() || "com.suttikeat.chatgpt_obsidian_sync"
    }
  });

  state.settings = response.settings;
  showBanner("Settings saved.", false);
}

async function syncSelectedConversations() {
  hideResults();
  const selected = state.conversations.filter((conversation) => conversation.selected);
  if (!selected.length) {
    showBanner("Select at least one conversation to sync.", true);
    return;
  }

  const tab = await getActiveTab();
  showBanner(`Extracting ${selected.length} conversation(s) from ChatGPT...`, false);
  const extractionResponse = await sendTabMessage(tab.id, {
    type: "EXTRACT_CONVERSATIONS",
    conversationIds: selected.map((conversation) => conversation.conversationId)
  });

  if (!extractionResponse?.conversations?.length) {
    showBanner(extractionResponse?.errors?.[0]?.error || "No conversations could be extracted.", true);
    return;
  }

  const targetFolder = elements.targetFolderInput.value.trim() || "chatgpt";
  const syncResponse = await sendRuntimeMessage({
    type: "SYNC_CONVERSATIONS",
    payload: {
      targetFolder,
      conversations: extractionResponse.conversations
    }
  });

  if (syncResponse.ok) {
    showBanner(`Synced ${syncResponse.results.length} conversation(s) into Obsidian.`, false);
    await loadConversations();
    renderResults(syncResponse.results, false);
    return;
  }

  showBanner(syncResponse.error || "Sync failed.", true);
  renderFallbackResults(syncResponse.fallbackPayloads || []);
}

function renderResults(results, isError) {
  elements.resultPanel.classList.remove("hidden");
  elements.resultPanel.innerHTML = "";
  for (const result of results) {
    const card = document.createElement("div");
    card.className = `result-card${isError || result.error ? " error" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(result.title || result.conversationId || "Conversation")}</strong><br>
      ${escapeHtml(result.error || `Status: ${result.status || "synced"}`)}<br>
      ${result.filePath ? escapeHtml(result.filePath) : ""}
    `;
    elements.resultPanel.appendChild(card);
  }
}

function renderFallbackResults(payloads) {
  if (!payloads.length) {
    return;
  }

  elements.resultPanel.classList.remove("hidden");
  elements.resultPanel.innerHTML = `<div class="result-card error">Native helper unavailable. Download or copy Markdown manually for now.</div>`;

  for (const payload of payloads) {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <strong>${escapeHtml(payload.title || "Conversation")}</strong><br>
      ${escapeHtml(payload.filename)}
      <div class="result-actions">
        <button class="button secondary" data-action="download" data-id="${escapeAttribute(payload.conversationId)}">Download</button>
        <button class="button ghost" data-action="copy" data-id="${escapeAttribute(payload.conversationId)}">Copy markdown</button>
      </div>
    `;
    card.dataset.payload = JSON.stringify(payload);
    elements.resultPanel.appendChild(card);
  }

  for (const button of elements.resultPanel.querySelectorAll("button[data-action]")) {
    button.addEventListener("click", async (event) => {
      const action = event.target.getAttribute("data-action");
      const conversationId = event.target.getAttribute("data-id");
      const payload = payloads.find((entry) => entry.conversationId === conversationId);
      if (!payload) {
        return;
      }

      if (action === "copy") {
        await navigator.clipboard.writeText(payload.markdown);
        showBanner(`Copied Markdown for ${payload.title}.`, false);
        return;
      }

      if (action === "download") {
        const blob = new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        await downloadMarkdown(url, payload.filename);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
}

function hideResults() {
  elements.resultPanel.classList.add("hidden");
  elements.resultPanel.innerHTML = "";
}

function deriveStatusBadge(metadata) {
  if (!metadata) {
    return { label: "Not synced", className: "neutral" };
  }
  if (metadata.status === "failed") {
    return { label: "Failed", className: "failed" };
  }
  if (metadata.status === "updated") {
    return { label: "Updated", className: "updated" };
  }
  return { label: "Synced", className: "synced" };
}

function showBanner(message, isError) {
  elements.statusBanner.textContent = message;
  elements.statusBanner.classList.remove("hidden");
  elements.statusBanner.classList.toggle("error", Boolean(isError));
}

function isSupportedChatGptUrl(url) {
  return typeof url === "string" && /https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tabs[0] || null);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function downloadMarkdown(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
