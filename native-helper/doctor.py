#!/usr/bin/env python3
"""Checks whether the native helper is configured and can write into the target vault."""

from __future__ import annotations

import json
from pathlib import Path

from chatgpt_obsidian_sync import CONFIG_PATH, HOST_NAME, load_config
from install_host import CHROME_NATIVE_HOST_DIR


def main() -> int:
    print("ChatGPT to Obsidian doctor")
    print()

    if not CONFIG_PATH.exists():
        print(f"[FAIL] Missing config: {CONFIG_PATH}")
        return 1

    print(f"[OK] Config found: {CONFIG_PATH}")
    print(json.dumps(json.loads(CONFIG_PATH.read_text(encoding='utf-8')), indent=2))
    print()

    try:
        config = load_config()
    except Exception as error:
        print(f"[FAIL] Invalid config: {error}")
        return 1

    if not config.vault_path.exists():
        print(f"[FAIL] Vault path does not exist: {config.vault_path}")
        return 1
    print(f"[OK] Vault exists: {config.vault_path}")

    target_dir = config.vault_path / config.source_folder
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        probe = target_dir / ".chatgpt-obsidian-sync-write-test"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink()
    except Exception as error:
        print(f"[FAIL] Cannot write to target folder {target_dir}: {error}")
        return 1
    print(f"[OK] Target folder writable: {target_dir}")

    manifest_path = CHROME_NATIVE_HOST_DIR / f"{HOST_NAME}.json"
    if not manifest_path.exists():
        print(f"[FAIL] Missing Chrome native host manifest: {manifest_path}")
        return 1
    print(f"[OK] Native host manifest found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    print("[OK] Manifest summary:")
    print(json.dumps(manifest, indent=2))
    print()

    launcher_path = Path(manifest.get("path", ""))
    if not launcher_path.exists():
        print(f"[FAIL] Launcher path in manifest does not exist: {launcher_path}")
        return 1
    print(f"[OK] Launcher exists: {launcher_path}")
    print()
    print("Everything looks ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
