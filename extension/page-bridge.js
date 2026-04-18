(function bootstrapPageBridge() {
  const SOURCE = "chatgpt-obsidian-sync";
  const SENDER = "page-bridge";

  if (window.__CHATGPT_OBSIDIAN_SYNC_BRIDGE__) {
    return;
  }

  window.__CHATGPT_OBSIDIAN_SYNC_BRIDGE__ = true;
  window.__CHATGPT_OBSIDIAN_SYNC_TEXTDOCS__ = window.__CHATGPT_OBSIDIAN_SYNC_TEXTDOCS__ || {};

  const postPayload = (type, payload) => {
    window.postMessage({ source: SOURCE, sender: SENDER, type, payload }, "*");
  };

  const handleTextdocsResponse = async (url, responseLike) => {
    try {
      const match = String(url).match(/\/backend-api\/conversation\/([a-zA-Z0-9-]+)\/textdocs/);
      if (!match) {
        return;
      }

      const conversationId = match[1];
      let payload = null;

      if (typeof responseLike.clone === "function") {
        const response = responseLike;
        if (!response.ok) {
          return;
        }
        payload = await response.clone().json();
      } else if (typeof responseLike === "string") {
        payload = JSON.parse(responseLike);
      }

      if (!Array.isArray(payload)) {
        return;
      }

      window.__CHATGPT_OBSIDIAN_SYNC_TEXTDOCS__[conversationId] = payload;
      postPayload("TEXTDOCS_RESPONSE", { conversationId, data: payload });
    } catch (_error) {
      // Ignore parsing issues from unrelated requests.
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const resource = args[0];
      const url = typeof resource === "string" ? resource : resource?.url || "";
      handleTextdocsResponse(url, response);
    } catch (_error) {
      // Ignore bridge failures and preserve page behavior.
    }
    return response;
  };

  const OriginalXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let requestUrl = "";

    const originalOpen = xhr.open;
    xhr.open = function patchedOpen(method, url, ...rest) {
      requestUrl = typeof url === "string" ? url : "";
      return originalOpen.call(this, method, url, ...rest);
    };

    xhr.addEventListener("load", () => {
      handleTextdocsResponse(requestUrl, xhr.responseText);
    });

    return xhr;
  }

  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== SOURCE || data.sender !== "content-script") {
      return;
    }

    if (data.type !== "REQUEST_TEXTDOCS_SNAPSHOT") {
      return;
    }

    const requestId = data.payload?.requestId || null;
    const conversationId = data.payload?.conversationId || null;
    const stored = window.__CHATGPT_OBSIDIAN_SYNC_TEXTDOCS__ || {};
    const snapshot = conversationId ? (stored[conversationId] || []) : stored;
    postPayload("TEXTDOCS_SNAPSHOT", { requestId, conversationId, data: snapshot });
  });
})();
