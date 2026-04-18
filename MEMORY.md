# Project Memory: ChatGPT to Obsidian Sync

This file is a working memory for future sessions. It captures what was built, what bugs were found, what fixes were applied, what is verified, and what is still unresolved.

## Project Goal

Build a Chrome extension plus a macOS native helper that lets the user manually select ChatGPT conversations and sync them into Obsidian as Markdown notes.

Current product scope:
- ChatGPT only
- Manual sync only
- macOS only
- One conversation becomes one Markdown note
- Obsidian vault path is configured locally through the native helper config

User vault path currently used:
- `/Users/suttikeat/Library/Mobile Documents/iCloud~md~obsidian/Documents/Suttikeat/Suttikeat`

Default note target folder:
- `chatgpt`

## Current Architecture

### Chrome extension

- `extension/popup.html`, `extension/popup.js`, `extension/popup.css`
  - Popup UI for selecting visible ChatGPT conversations and starting sync
  - Settings for native host name and target folder
- `extension/background.js`
  - Receives normalized conversation payloads from popup/content script
  - Computes content hash
  - Sends payload to native helper
  - Stores sync metadata in Chrome local storage
- `extension/content.js`
  - Main extraction logic from ChatGPT page
  - Handles conversation listing
  - Handles current-chat DOM extraction
  - Handles textdoc merge
  - Handles canvas/code/CLI block extraction
- `extension/page-bridge.js`
  - Runs in `MAIN` world
  - Hooks page network activity and stores textdocs from page-side requests
  - Replies to content script snapshot requests
- `extension/manifest.json`
  - Has two content scripts now:
    - `page-bridge.js` in `MAIN` world, `document_start`
    - `content.js` in isolated world, `document_start`

### Native helper

- `native-helper/chatgpt_obsidian_sync.py`
  - Chrome Native Messaging host
  - Writes Markdown notes into Obsidian
- `native-helper/install_host.py`
  - Installs Chrome native host manifest
- `native-helper/setup_macos.py`
  - One-shot setup script
- `native-helper/doctor.py`
  - Checks config, manifest, and write access

### Docs and tests

- `README.md`
  - Setup guide and current limitations
- `tests/markdown.test.js`
- `tests/test_helper.py`

## Verified Working Features

These were confirmed during the conversation:

- Native helper installation flow works on macOS after switching to a launcher script that uses absolute `python3`
- Notes can be written into the configured Obsidian vault
- ChatGPT canvas code can now be extracted in full content terms
- Bullet point duplication issue was fixed
- Bullet point line-break issue was fixed

## Important Runtime Notes

### Restart behavior

Once installed and working, after shutting down the machine and reopening later, the user should generally be able to:
- open Chrome
- open ChatGPT
- use the extension directly

No reinstall should be needed unless:
- extension files changed and need reload
- native host manifest/config changed
- iCloud-backed vault path is not currently available locally

### Native helper permissions

The user asked whether Full Disk Access was needed for the Obsidian iCloud path.

Conclusion reached:
- normally Full Disk Access is not required for the runtime app flow
- but this Codex session itself cannot write outside the workspace without escalation

## Bug History and Fix Timeline

This section is the main memory for future debugging sessions.

### 1. Native host exited immediately

Symptoms:
- Popup showed `Native host has exited`
- Fallback export still worked

Root cause:
- Chrome launched the native host from GUI environment
- helper originally relied on `#!/usr/bin/env python3`
- GUI-launched Chrome did not reliably inherit the same PATH as Terminal

Fix applied:
- `install_host.py` now creates a launcher shell script using absolute `python3`
- manifest points to launcher instead of `.py` file directly

Status:
- fixed
- native helper path and manifest flow are working

### 2. Canvas code missing entirely

Symptoms:
- ChatGPT conversation synced, but canvas/code editor content was missing from the note

Investigation:
- User provided DOM snippet showing canvas content in CodeMirror:
  - `.cm-content`
  - `.cm-line`
  - `data-language="typescript"`
- Later user provided network response from:
  - `/backend-api/conversation/<id>/textdocs`

Root cause:
- canvas code is not always part of ordinary chat message text
- sometimes it exists in CodeMirror DOM
- sometimes it exists in `textdocs`

Fixes applied:
- DOM parser support for `.cm-content[data-language]`
- textdoc support added using page-side bridge and snapshot flow
- DOM-first flow for current chat
- merge of textdocs into the assistant message

Status:
- partially fixed initially
- later reported as working in terms of code completeness
- remaining limitation is code position mapping

### 3. Canvas code was incomplete

Symptoms:
- only around 20 percent of canvas code appeared
- content got cut off

Root cause:
- DOM read relied on virtualized CodeMirror rendering
- only visible portion of code was present in DOM

Fix applied:
- moved toward using `textdocs` payload captured from page-side requests
- page bridge in `MAIN` world stores textdocs for content script snapshot access

Status:
- fixed enough that user reported code content now comes through completely

### 4. Canvas code attached to wrong message

Symptoms:
- code was inserted under the wrong assistant reply
- usually appended to a later or earlier assistant message

Root cause:
- mapping textdocs to exact in-thread message position is not fully known
- current heuristics use assistant occurrence and DOM anchors

Fixes attempted:
- use assistant occurrence from DOM artifacts
- merge textdocs against assistant message indices
- avoid direct textdoc fetch from content script when auth failed

Current status:
- still not perfect
- user said this is acceptable for now as long as README/memory notes it

Documented limitation:
- code may be appended near the end of the assistant message instead of original exact in-line position

### 5. Bullet point text doubled in Markdown

Symptoms:
- exported Markdown duplicated text after bullet points

Example problem shape:
- list item text appeared twice because both `li` and nested inner blocks like `p` were serialized

Root cause:
- extractor iterated `li`, `p`, headings, blockquotes all together
- nested block nodes inside list items were processed again

Fix applied:
- filter blocks using ancestor checks
- serialize list items once
- normalize nested text properly

Status:
- fixed and user confirmed it

### 6. Bullet point text broke into new line incorrectly

Symptoms:
- output looked like:

```md
- 
เปิดได้เลย

เปิดได้เลย
```

Root cause:
- list text was taken from nested structure with poor normalization

Fix applied:
- list-item-specific normalization
- flatten list item text and normalize spacing/newlines

Status:
- fixed and user confirmed it

### 7. CLI / command blocks exported only as `Bash`

Symptoms:
- command blocks in ChatGPT response exported like:

```md
``` 
Bash
```
```

- actual command text appeared either nowhere or appended later at end of message

Inspector findings from user:
- command block header is a separate DOM node containing `Bash`
- actual command content lives in:
  - `.cm-content.q9tKkq_readonly`
- some blocks are single-line
- some blocks contain `<br>`
- outer container is inside `<pre>`

Fixes attempted in order:
- detect readonly CodeMirror-like blocks using specific class
- parse `span + br` rendered text
- avoid serializing special `<pre>` containers as plain text
- add conversation-level readonly fallback extraction
- strip placeholder language fences like ` ```Bash``` `
- try replacing placeholder fences with actual readonly blocks
- later replaced regex strategy with line-based fenced-block parser

Previous status (before final fix):
- partially fixed
- CLI output came through but placement was wrong
- placeholder `Bash` blocks remained in original positions
- actual CLI code blocks were appended at the end

Final root cause identified (2026-04-19):
- `extractMarkdownFromNode()` was appending `readonlyCodeBlocks` directly to the return value alongside `text` and `canvasBlocks`
- this meant the code blocks were already embedded in `contentMarkdown` before `augmentConversationWithDomReadonlyArtifacts()` ran
- the dedup check `if (!currentContent.includes(artifactMarkdown))` evaluated to `false` because the blocks were already present
- therefore `mergeReadonlyBlocksIntoContent()` was never called
- the placeholder fences (` ```\nBash\n``` `) were never replaced — they stayed in the middle of the text
- the actual code sat at the end, duplicated from the early append

Final fix applied:
- removed `readonlyCodeBlocks` from both return paths in `extractMarkdownFromNode()`
- now only `canvasBlocks` are appended inline
- `readonlyCodeBlocks` are exclusively handled by `augmentConversationWithDomReadonlyArtifacts()` which calls `mergeReadonlyBlocksIntoContent()` → `replacePlaceholderFences()`
- `replacePlaceholderFences()` finds each ` ```\nBash\n``` ` placeholder and replaces it with the corresponding actual code block in order

Debug method used:
- added `[SYNC-DEBUG]` prefixed console.log statements across the extraction and merge pipeline
- first run confirmed blocks were extracted correctly but `mergeReadonlyBlocksIntoContent` was never called
- identified the double-append causing the dedup skip
- after fix, second run confirmed all 4 placeholders matched and replaced: `consumed 4 / 4`

Status:
- **FIXED** — user confirmed 2026-04-19
- all 4 CLI code blocks replaced in-place at correct positions
- language detected as `bash` (from placeholder text), blocks rendered with `bash` fence

## Current Unresolved Issues

### 1. CLI code block position replacement — RESOLVED

This was the main outstanding bug. It was fixed on 2026-04-19.
See Bug #7 above for the full root cause and fix details.

The debug logging (`[SYNC-DEBUG]` prefix) is still in `content.js` and can be removed when no longer needed.

### 2. Canvas code position is still approximate

Behavior:
- code content is present
- exact placement relative to assistant prose is not always right

Accepted for now:
- yes
- documented in `README.md`

## Latest State of `extension/content.js`

Important current behaviors:

- For current open chat:
  - use DOM-first extraction
  - collect canvas artifacts from DOM
  - request textdocs snapshot from page bridge
  - merge textdocs
  - merge readonly CLI artifacts
- For non-current chats:
  - still tries conversation API

Recent helper functions added:
- `extractCanvasBlocksFromNode`
- `extractReadonlyCodeBlocksFromNode`
- `findReadonlyCodeNodes`
- `extractNodeRenderedText`
- `augmentConversationWithDomReadonlyArtifacts`
- `mergeReadonlyBlocksIntoContent`
- `replacePlaceholderFences`

## README Notes Already Added

`README.md` already includes a limitation note that:
- canvas code extraction is working
- exact code block position inside assistant message may still be imperfect

## Recommended Next Session Starting Point

If continuing in a new session, start here:

1. Read this file first
2. The CLI code block placement bug is now FIXED — no need to revisit
3. Debug logging (`[SYNC-DEBUG]`) is still present in `content.js` — remove it when no longer needed
4. Focus on any new extraction issues or feature requests
5. Do not revisit native helper setup unless user reports native host problems again

Possible next improvements:
- remove debug logging from `content.js`
- investigate header detection for readonly code blocks (currently returns empty string, falling back to `text` language — the `Bash` label in the DOM is not being found by `findReadonlyCodeHeaderNode`)
- improve canvas code exact position mapping (currently acceptable)

## Commands for Validation

After code changes:

```bash
npm test
```

Optional syntax checks used during the session:

```bash
node -e "const fs=require('fs'); new Function(fs.readFileSync('extension/content.js','utf8')); console.log('content.js syntax ok')"
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('extension/manifest.json','utf8')); console.log('manifest.json ok')"
python3 -m py_compile native-helper/chatgpt_obsidian_sync.py native-helper/install_host.py native-helper/setup_macos.py native-helper/doctor.py
```

## Verified / Not Yet Verified Matrix

### Verified by user

- native helper writes into Obsidian
- canvas code content now comes through
- bullet duplication fixed
- bullet line-break formatting fixed
- CLI content is extractable
- CLI code blocks now replace placeholders in-place at correct positions (verified 2026-04-19, 4/4 blocks consumed)

### Not yet user-verified for latest code

- readonly code block header detection (`findReadonlyCodeHeaderNode`) returns empty — language falls back to `text` instead of `bash`. The `replacePlaceholderFences` flow compensates by using the placeholder label as the language, so the output is correct. But the header detection itself could be improved.

## Short Handoff Summary

Project is mostly working. All major extraction bugs are now fixed.

Working:
- setup
- native helper
- note writing
- bullet formatting
- canvas code extraction
- CLI command block extraction and in-place replacement ✅ (fixed 2026-04-19)

Minor remaining items:
- canvas/code exact position is still approximate but acceptable for now
- readonly code block header detection returns empty (language fallback compensates)
- debug logging (`[SYNC-DEBUG]`) is still in `content.js` — safe to remove when stable
