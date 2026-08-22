from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "prepare_upgrade", ROOT / "scripts" / "prepare_upgrade.py"
)
assert SPEC is not None and SPEC.loader is not None
prepare_upgrade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_upgrade)


class RelocationTests(unittest.TestCase):
    def test_unique_context_relocates_without_occurrence_rank(self) -> None:
        left = b"L" * 128
        right = b"R" * 128
        old = b"prefix" + left + b"Settings" + right + b"suffix"
        new = b"new-prefix" + left + b"Settings" + right + b"Settings elsewhere"
        item = {
            "offset": hex(len(b"prefix") + len(left)),
            "en": "Settings",
            "zh": "设置",
            "context": "/settings 面板标题",
        }

        relocated, evidence = prepare_upgrade.relocate_patch(item, old, new)

        self.assertIsNotNone(relocated)
        self.assertEqual(
            int(relocated["offset"], 0), len(b"new-prefix") + len(left)
        )
        self.assertIn("上下文", evidence["method"])

    def test_ambiguous_context_fails_closed(self) -> None:
        left = b"L" * 128
        right = b"R" * 128
        old = left + b"Close" + right
        repeated = left + b"Close" + right
        item = {
            "offset": hex(len(left)),
            "en": "Close",
            "zh": "关闭",
            "context": "关闭提示",
        }

        relocated, review = prepare_upgrade.relocate_patch(
            item, old, repeated + repeated
        )

        self.assertIsNone(relocated)
        self.assertEqual(review["reason"], "无法用唯一上下文确认新偏移")


class SkillDiscoveryTests(unittest.TestCase):
    def test_new_and_changed_skills_are_reported_compactly(self) -> None:
        with tempfile.TemporaryDirectory(prefix="antigravity-skill-test-") as temp:
            root = Path(temp)
            known = root / "skills" / "known" / "SKILL.md"
            new = root / "skills" / "new-skill" / "SKILL.md"
            known.parent.mkdir(parents=True)
            new.parent.mkdir(parents=True)
            known.write_text("---\ndescription: Changed upstream\n---\n", encoding="utf-8")
            new.write_text("---\ndescription: New capability\n---\n", encoding="utf-8")
            manifest = {
                "patches": [
                    {
                        "path": "skills/known/SKILL.md",
                        "en": "description: Previous",
                        "zh": "description: 旧译文",
                        "context": "/known 右侧说明",
                    }
                ]
            }

            new_items, changed_items = prepare_upgrade.discover_skill_review(root, manifest)

        self.assertEqual(new_items[0]["path"], "skills/new-skill/SKILL.md")
        self.assertEqual(changed_items[0]["current"], "description: Changed upstream")


if __name__ == "__main__":
    unittest.main()
