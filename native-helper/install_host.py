#!/usr/bin/env python3
"""Install the Chrome native messaging host manifest for the local helper."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


HOST_NAME = "com.suttikeat.chatgpt_obsidian_sync"
CHROME_NATIVE_HOST_DIR = (
    Path.home()
    / "Library"
    / "Application Support"
    / "Google"
    / "Chrome"
    / "NativeMessagingHosts"
)
LAUNCHER_PATH = Path.home() / ".local" / "share" / "chatgpt-obsidian-sync" / "launch_native_host.sh"


def build_manifest(script_path: Path, extension_id: str) -> dict[str, object]:
    return {
        "name": HOST_NAME,
        "description": "Sync ChatGPT conversations into Obsidian",
        "path": str(script_path),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install the Chrome native messaging host manifest."
    )
    parser.add_argument(
        "--extension-id",
        help="Chrome extension ID from chrome://extensions after loading unpacked.",
    )
    return parser.parse_args()


def resolve_python3() -> Path:
    python3_path = shutil.which("python3")
    if not python3_path:
        raise FileNotFoundError("python3 was not found in PATH.")
    return Path(python3_path).resolve()


def write_launcher(helper_script_path: Path) -> Path:
    python3_path = resolve_python3()
    LAUNCHER_PATH.parent.mkdir(parents=True, exist_ok=True)
    launcher = "\n".join(
        [
            "#!/bin/sh",
            f'exec "{python3_path}" "{helper_script_path}"'
        ]
    ) + "\n"
    LAUNCHER_PATH.write_text(launcher, encoding="utf-8")
    LAUNCHER_PATH.chmod(0o755)
    return LAUNCHER_PATH


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    helper_script_path = (repo_root / "native-helper" / "chatgpt_obsidian_sync.py").resolve()
    if not helper_script_path.exists():
        raise FileNotFoundError(f"Native helper script not found at {helper_script_path}")

    extension_id = (args.extension_id or "").strip()
    if not extension_id:
        extension_id = input(
            "Enter the Chrome extension ID after loading the unpacked extension: "
        ).strip()
    if not extension_id:
        raise ValueError("A Chrome extension ID is required.")

    helper_script_path.chmod(0o755)
    launcher_path = write_launcher(helper_script_path)
    CHROME_NATIVE_HOST_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = CHROME_NATIVE_HOST_DIR / f"{HOST_NAME}.json"
    manifest = build_manifest(launcher_path, extension_id)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote host manifest to {manifest_path}")
    print(f"Helper executable: {helper_script_path}")
    print(f"Launcher executable: {launcher_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
