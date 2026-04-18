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

Current status:
- partially fixed
- user confirmed CLI output now comes through
- but placement is still wrong:
  - placeholder `Bash` blocks remain in original positions
  - actual CLI code blocks get appended at the end in correct order

This is the main currently unresolved issue.

## Current Unresolved Issues

### 1. CLI code block position replacement is still not working

Observed current behavior:
- original text contains correctly placed placeholders:

```md
``` 
Bash
```
```

- actual commands are appended later at end of message
- order of commands is correct
- location is wrong

Latest hypothesis:
- placeholder format in `contentMarkdown` may not match the replacement logic exactly
- the placeholder may be created through another path before readonly merge runs
- or content may be normalized differently than expected before replacement

Most likely next debugging step:
- add debug output inside extraction flow for one current message:
  - raw `contentMarkdown` before readonly merge
  - extracted readonly blocks array
  - merged result after replacement
- ideally expose this in popup or temporary console logging so no more manual DOM guessing is needed

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
2. Inspect `extension/content.js`
3. Focus on the unresolved CLI placeholder replacement issue
4. Do not revisit native helper setup unless user reports native host problems again

Most likely next implementation step:
- add a temporary debug mode in `popup.js` or `content.js` that logs:
  - `currentContent` before readonly merge
  - `artifact.blocks`
  - result of `mergeReadonlyBlocksIntoContent`
- compare the exact placeholder fence shape in runtime against what `replacePlaceholderFences()` expects

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
- CLI content is at least extractable

### Not yet user-verified for latest code

At the time this memory file was created:
- latest placeholder replacement logic in `extension/content.js` had been coded and test/syntax-checked
- user had not yet confirmed whether the newest version fixes CLI block placement

This means:
- treat the latest `extension/content.js` state as implemented but not fully validated in real ChatGPT UI

## Short Handoff Summary

Project is mostly working.

Working:
- setup
- native helper
- note writing
- bullet formatting
- canvas code extraction

Still problematic:
- CLI command blocks show correct content, but are appended at the end instead of replacing the in-place `Bash` placeholders
- canvas/code exact position is still approximate but acceptable for now
