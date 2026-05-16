# ChatGPT to Obsidian Sync

Chrome extension plus a macOS native messaging helper that lets you select ChatGPT conversations and sync them into Obsidian as Markdown notes.

## What is included

- Chrome extension MVP for `chatgpt.com` and `chat.openai.com`
- Manual multi-select sync from a popup
- Native messaging helper for macOS that writes Markdown notes into an Obsidian vault
- Popup folder picker that loads target folders from the configured vault
- Stable note format with frontmatter and transcript sections
- Local sync metadata so re-syncs update existing notes and show status
- Fallback manual export when the native helper is unavailable

## Repo layout

- [`extension/manifest.json`](extension/manifest.json)
- [`extension/popup.html`](extension/popup.html)
- [`extension/popup.js`](extension/popup.js)
- [`extension/background.js`](extension/background.js)
- [`extension/content.js`](extension/content.js)
- [`native-helper/chatgpt_obsidian_sync.py`](native-helper/chatgpt_obsidian_sync.py)
- [`native-helper/install_host.py`](native-helper/install_host.py)
- [`native-helper/config.example.json`](native-helper/config.example.json)

## Current flow

1. Open ChatGPT in Chrome.
2. Open the extension popup.
3. Refresh the conversation list if needed.
4. Select one or more conversations.
5. Click `Sync selected`.
6. The extension asks the content script to fetch and normalize the selected conversations.
7. The background worker forwards the payload to the macOS native helper.
8. The native helper writes one Markdown file per conversation into your Obsidian vault.

## Chat note format

Each conversation syncs into one machine-managed Markdown file:

```md
---
source: chatgpt
conversation_id: "abc123"
title: "Weekly planning"
source_url: "https://chatgpt.com/c/abc123"
synced_at: "2026-04-14T16:00:00+07:00"
last_message_at: "2026-04-14T15:42:10+07:00"
message_count: 4
content_hash: "3d20e4c3"
tags:
  - ai/chatgpt
  - inbox
---

# Weekly planning

## Summary
Optional placeholder for later manual note-taking or future auto-summary.

## Transcript

### User
Help me plan the week.

### ChatGPT
Here is a plan...

## Metadata
- Source: ChatGPT
- Conversation ID: `abc123`
- Synced: `2026-04-14 16:00 +07:00`
```

## Native helper setup on macOS

This project is ready to run, but there is one important dependency:

- Chrome native messaging needs the real extension ID after you load the unpacked extension once.

The shortest installation flow is below.

### Quick start

1. Load the extension from the [`extension`](extension) folder in Chrome.
2. Copy the extension ID from `chrome://extensions`.
3. Run the one-shot setup script:

```bash
python3 native-helper/setup_macos.py --extension-id YOUR_EXTENSION_ID
```

This will:

- create `~/.config/chatgpt-obsidian-sync/config.json`
- point `vault_path` to your Obsidian vault
- set `source_folder` to `chatgpt`
- install the Chrome native host manifest
- mark the helper script executable

The default vault path already matches your vault:

`/Users/suttikeat/Library/Mobile Documents/iCloud~md~obsidian/Documents/Suttikeat/Suttikeat`

### Verify the installation

Run:

```bash
python3 native-helper/doctor.py
```

It checks:

- config exists
- vault path exists
- target folder is writable
- Chrome native host manifest exists

### 1. Create a config file

Copy [`native-helper/config.example.json`](native-helper/config.example.json) to:

`~/.config/chatgpt-obsidian-sync/config.json`

Fill in:

- `vault_path`: absolute path to your Obsidian vault
- `source_folder`: relative folder inside the vault, for example `chatgpt`

### 2. Install the native messaging host

Run:

```bash
python3 native-helper/install_host.py --extension-id YOUR_EXTENSION_ID
```

This creates a host manifest in:

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.suttikeat.chatgpt_obsidian_sync.json`

Run this command again whenever Chrome gives the unpacked extension a new ID, for example after removing and loading the extension again.

### 3. Load the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the [`extension`](extension) folder
5. Pin the extension if you want quick access from the toolbar

## First sync

1. Open ChatGPT in Chrome and make sure the chat you want is visible.
2. Click the extension icon.
3. Click `Refresh chats`.
4. Select one or more conversations.
5. Choose the target folder from the vault folder dropdown.
6. Click `Sync selected`.
7. Open Obsidian and check:

`<your-vault>/chatgpt/`

You should see files named like:

`Weekly planning.md`

Conversation titles are preserved in filenames, including Thai titles such as:

`การจัดการข้อมูลโปรไฟล์ AI.md`

## Notes about ChatGPT extraction

- The extension first tries to fetch ChatGPT conversation JSON from `/backend-api/conversation/<id>`.
- If that fails for the currently open conversation, it falls back to DOM extraction from the page.
- Multi-select works from the sidebar links that are currently visible in the ChatGPT UI.

## Target folder picker

The popup loads folder options from the configured Obsidian vault through the macOS native helper. Use `Refresh` next to the target folder dropdown after creating new folders in Obsidian.

The selected folder is stored as a path relative to the vault root, for example:

`200_Areas/202_AI_Automation/ChatGPT_Logs`

If the dropdown only shows `chatgpt`, the native helper probably cannot be reached from the current extension ID. Copy the current ID from `chrome://extensions`, then run:

```bash
python3 native-helper/install_host.py --extension-id YOUR_EXTENSION_ID
```

Reload the extension and click `Refresh` next to the dropdown.

## Limitations in v1

- ChatGPT only
- Manual sync only
- Text and Markdown content only
- No attachment export
- Requires the user to provide a real vault path in helper config
- If ChatGPT changes its internal API or DOM, selectors or normalization may need updates
- Canvas code extraction for ChatGPT is working. CLI command blocks (e.g. Bash) are now correctly placed at their original position in the message. Canvas (editor) code blocks may still appear near the end of the assistant message instead of the exact inline position; this is acceptable for now and position mapping can be improved later.

## Testing

Run:

```bash
npm test
```
