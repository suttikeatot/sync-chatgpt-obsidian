#!/usr/bin/env python3
"""Chrome Native Messaging host for syncing ChatGPT conversations into Obsidian."""

from __future__ import annotations

import json
import logging
import os
import re
import struct
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HOST_NAME = "com.suttikeat.chatgpt_obsidian_sync"
CONFIG_PATH = Path.home() / ".config" / "chatgpt-obsidian-sync" / "config.json"
LOG_PATH = Path.home() / ".local" / "state" / "chatgpt-obsidian-sync" / "helper.log"


def ensure_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


@dataclass
class AppConfig:
    vault_path: Path
    source_folder: str = "chatgpt"


def load_config() -> AppConfig:
    config_path = Path(os.environ.get("CHATGPT_OBSIDIAN_SYNC_CONFIG", CONFIG_PATH))
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found at {config_path}. Copy native-helper/config.example.json first."
        )

    data = json.loads(config_path.read_text(encoding="utf-8"))
    vault_path_value = data.get("vault_path")
    if not vault_path_value:
        raise ValueError("Config field 'vault_path' is required.")

    vault_path = Path(vault_path_value).expanduser().resolve()
    source_folder = sanitize_relative_folder(data.get("source_folder", "chatgpt"))

    return AppConfig(vault_path=vault_path, source_folder=source_folder)


def sanitize_relative_folder(folder: str) -> str:
    safe = re.sub(r"[\\]+", "/", str(folder or "chatgpt")).strip().strip("/")
    safe = re.sub(r"\.\.+", ".", safe)
    return safe or "chatgpt"


def read_message() -> dict[str, Any] | None:
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack("<I", raw_length)[0]
    payload = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(payload)


def write_message(message: dict[str, Any]) -> None:
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def process_request(request: dict[str, Any], config: AppConfig) -> dict[str, Any]:
    if request.get("type") != "syncConversations":
        return {"ok": False, "error": f"Unsupported request type: {request.get('type')}"}

    requested_folder = request.get("settings", {}).get("targetFolder") or config.source_folder
    output_folder = (config.vault_path / sanitize_relative_folder(requested_folder)).resolve()

    if not str(output_folder).startswith(str(config.vault_path)):
        return {"ok": False, "error": "Target folder must stay inside the configured vault."}

    output_folder.mkdir(parents=True, exist_ok=True)

    results = []
    for conversation in request.get("conversations", []):
        try:
            result = sync_conversation(conversation, output_folder)
        except Exception as error:  # pragma: no cover
            logging.exception("Failed to sync conversation %s", conversation.get("conversationId"))
            result = {
                "conversationId": conversation.get("conversationId"),
                "title": conversation.get("title", "Untitled conversation"),
                "status": "failed",
                "error": str(error),
                "syncedAt": datetime.now(timezone.utc).isoformat(),
            }
        results.append(result)

    return {"ok": True, "results": results}


def sync_conversation(conversation: dict[str, Any], output_folder: Path) -> dict[str, Any]:
    conversation_id = conversation.get("conversationId")
    if not conversation_id:
        raise ValueError("conversationId is required.")

    title = conversation.get("title") or f"Conversation {conversation_id[:8]}"
    filename = build_conversation_filename(title, conversation_id)
    target_path = output_folder / filename
    existing_path = find_existing_conversation_path(output_folder, conversation_id)

    markdown = render_conversation_markdown(conversation)

    previous_hash = None
    if existing_path and existing_path.exists():
        previous_hash = extract_content_hash(existing_path.read_text(encoding="utf-8"))
        if existing_path != target_path:
            existing_path.rename(target_path)

    target_path.write_text(markdown, encoding="utf-8")

    next_hash = conversation.get("contentHash")
    status = "updated" if previous_hash and previous_hash != next_hash else "synced"

    return {
        "conversationId": conversation_id,
        "title": title,
        "status": status,
        "filePath": str(target_path),
        "syncedAt": datetime.now(timezone.utc).isoformat(),
    }


def build_conversation_filename(title: str, conversation_id: str) -> str:
    slug = slugify(title or "conversation")
    return f"{slug}--{conversation_id}.md"


def find_existing_conversation_path(output_folder: Path, conversation_id: str) -> Path | None:
    pattern = f"*--{conversation_id}.md"
    matches = list(output_folder.glob(pattern))
    return matches[0] if matches else None


def extract_content_hash(markdown: str) -> str | None:
    match = re.search(r'^content_hash:\s*"([^"]+)"$', markdown, flags=re.MULTILINE)
    return match.group(1) if match else None


def slugify(value: str) -> str:
    ascii_only = value.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    return slug[:80] or "conversation"


def render_conversation_markdown(conversation: dict[str, Any]) -> str:
    messages = conversation.get("messages") or []
    synced_at = conversation.get("syncedAt") or datetime.now(timezone.utc).isoformat()
    last_message_at = find_last_message_at(messages)
    transcript_blocks = []

    for message in messages:
        role = role_to_label(message.get("role"))
        content = (message.get("contentMarkdown") or "").strip() or "_No content extracted._"
        transcript_blocks.append(f"### {role}\n{content}")

    transcript = "\n\n".join(transcript_blocks) if transcript_blocks else "_No messages extracted._"

    lines = [
        "---",
        "source: chatgpt",
        f'conversation_id: {yaml_quote(conversation.get("conversationId", ""))}',
        f'title: {yaml_quote(conversation.get("title") or "Untitled conversation")}',
        f'source_url: {yaml_quote(conversation.get("url") or "")}',
        f"synced_at: {yaml_quote(synced_at)}",
        f"last_message_at: {yaml_quote(last_message_at or '')}",
        f"message_count: {len(messages)}",
        f'content_hash: {yaml_quote(conversation.get("contentHash") or "")}',
        "tags:",
        "  - ai/chatgpt",
        "  - inbox",
        "---",
        "",
        f'# {conversation.get("title") or "Untitled conversation"}',
        "",
        "## Summary",
        "Optional placeholder for later manual note-taking or future auto-summary.",
        "",
        "## Transcript",
        transcript,
        "",
        "## Metadata",
        "- Source: ChatGPT",
        f'- Conversation ID: `{conversation.get("conversationId", "")}`',
        f"- Synced: `{synced_at}`",
    ]
    return "\n".join(lines)


def role_to_label(role: str | None) -> str:
    if role == "assistant":
        return "ChatGPT"
    if role == "system":
        return "System"
    return "User"


def yaml_quote(value: str) -> str:
    return json.dumps(str(value))


def find_last_message_at(messages: list[dict[str, Any]]) -> str | None:
    timestamps = [message.get("createdAt") for message in messages if message.get("createdAt")]
    timestamps.sort()
    return timestamps[-1] if timestamps else None


def main() -> int:
    ensure_logging()
    logging.info("Starting native host")

    try:
        config = load_config()
    except Exception as error:
        write_message({"ok": False, "error": str(error)})
        return 1

    try:
        while True:
            request = read_message()
            if request is None:
                break
            response = process_request(request, config)
            write_message(response)
    except Exception as error:  # pragma: no cover
        logging.exception("Native host crashed")
        write_message({"ok": False, "error": str(error)})
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
