#!/usr/bin/env python3
"""One-shot macOS setup for the ChatGPT to Obsidian native helper."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from install_host import CHROME_NATIVE_HOST_DIR, HOST_NAME, build_manifest, write_launcher


DEFAULT_VAULT_PATH = (
    "/Users/suttikeat/Library/Mobile Documents/iCloud~md~obsidian/Documents/Suttikeat/Suttikeat"
)
DEFAULT_SOURCE_FOLDER = "chatgpt"
CONFIG_DIR = Path.home() / ".config" / "chatgpt-obsidian-sync"
CONFIG_PATH = CONFIG_DIR / "config.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create the native helper config and Chrome host manifest."
    )
    parser.add_argument(
        "--vault-path",
        default=DEFAULT_VAULT_PATH,
        help="Absolute path to the Obsidian vault.",
    )
    parser.add_argument(
        "--source-folder",
        default=DEFAULT_SOURCE_FOLDER,
        help="Relative folder inside the vault to store ChatGPT notes.",
    )
    parser.add_argument(
        "--extension-id",
        required=True,
        help="Chrome extension ID from chrome://extensions after loading unpacked.",
    )
    return parser.parse_args()


def write_config(vault_path: str, source_folder: str) -> Path:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "vault_path": vault_path,
        "source_folder": source_folder,
    }
    CONFIG_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return CONFIG_PATH


def write_manifest(extension_id: str) -> Path:
    repo_root = Path(__file__).resolve().parent.parent
    helper_path = (repo_root / "native-helper" / "chatgpt_obsidian_sync.py").resolve()
    helper_path.chmod(0o755)
    launcher_path = write_launcher(helper_path)
    CHROME_NATIVE_HOST_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = CHROME_NATIVE_HOST_DIR / f"{HOST_NAME}.json"
    manifest = build_manifest(launcher_path, extension_id)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest_path


def main() -> int:
    args = parse_args()
    config_path = write_config(args.vault_path, args.source_folder)
    manifest_path = write_manifest(args.extension_id)

    print("Setup complete.")
    print(f"Config:   {config_path}")
    print(f"Manifest: {manifest_path}")
    print(f"Vault:    {args.vault_path}")
    print(f"Folder:   {args.source_folder}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
