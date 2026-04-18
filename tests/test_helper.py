import tempfile
import unittest
from pathlib import Path

import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "native-helper"))

import chatgpt_obsidian_sync as helper


class HelperTests(unittest.TestCase):
    def test_render_conversation_markdown_contains_frontmatter_and_transcript(self):
        conversation = {
            "conversationId": "abc123",
            "title": "Thai planning",
            "url": "https://chatgpt.com/c/abc123",
            "syncedAt": "2026-04-14T09:00:00Z",
            "contentHash": "1234abcd",
            "messages": [
                {"role": "user", "contentMarkdown": "สรุปงานวันนี้", "createdAt": "2026-04-14T08:00:00Z"},
                {"role": "assistant", "contentMarkdown": "- งาน A\n- งาน B", "createdAt": "2026-04-14T08:01:00Z"},
            ],
        }

        markdown = helper.render_conversation_markdown(conversation)

        self.assertIn('conversation_id: "abc123"', markdown)
        self.assertIn("# Thai planning", markdown)
        self.assertIn("### ChatGPT", markdown)
        self.assertIn("สรุปงานวันนี้", markdown)

    def test_sync_conversation_renames_old_title_file_for_same_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_folder = Path(tmpdir)
            old_path = output_folder / "old-title--conv-1.md"
            old_path.write_text('content_hash: "oldhash"\n', encoding="utf-8")

            result = helper.sync_conversation(
                {
                    "conversationId": "conv-1",
                    "title": "New title",
                    "url": "https://chatgpt.com/c/conv-1",
                    "syncedAt": "2026-04-14T09:00:00Z",
                    "contentHash": "newhash",
                    "messages": [{"role": "user", "contentMarkdown": "hello"}],
                },
                output_folder,
            )

            self.assertEqual(result["status"], "updated")
            self.assertFalse(old_path.exists())
            self.assertTrue((output_folder / "new-title--conv-1.md").exists())


if __name__ == "__main__":
    unittest.main()
