const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const backgroundPath = path.join(__dirname, "..", "extension", "background.js");
const source = fs.readFileSync(backgroundPath, "utf8");

const chromeStub = {
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} }
  },
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {}
    }
  }
};

const context = {
  chrome: chromeStub,
  console,
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(source, context);

test("renderConversationMarkdown preserves code fences and metadata", () => {
  const conversation = {
    conversationId: "abc-123",
    title: "Coding session",
    url: "https://chatgpt.com/c/abc-123",
    syncedAt: "2026-04-14T09:00:00.000Z",
    contentHash: "deadbeef",
    messages: [
      { role: "user", contentMarkdown: "Please write code", createdAt: "2026-04-14T08:00:00.000Z" },
      { role: "assistant", contentMarkdown: "```js\nconsole.log('hi')\n```", createdAt: "2026-04-14T08:01:00.000Z" }
    ]
  };

  const markdown = context.renderConversationMarkdown(conversation);
  assert.match(markdown, /conversation_id: "abc-123"/);
  assert.match(markdown, /### ChatGPT/);
  assert.match(markdown, /```js/);
  assert.match(markdown, /content_hash: "deadbeef"/);
});

test("buildConversationFilename includes a stable conversation id suffix", () => {
  const filename = context.buildConversationFilename({
    title: "My Weekly Plan",
    conversationId: "conv-999"
  });
  assert.equal(filename, "my-weekly-plan--conv-999.md");
});
