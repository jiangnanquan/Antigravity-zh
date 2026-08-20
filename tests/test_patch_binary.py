from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("patch_binary", ROOT / "scripts" / "patch_binary.py")
assert SPEC is not None and SPEC.loader is not None
patch_binary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(patch_binary)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class SourceSelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="antigravity-zh-test-")
        self.root = Path(self.temp_dir.name)
        self.target = self.root / "agy"
        self.legacy_backup = self.root / "agy.zh-backup"
        self.manifest = {
            "_meta": {
                "agy_version": "1.1.16",
                "sha256": digest(b"official-1.1.16"),
            }
        }

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def patch_paths(self):
        return mock.patch.multiple(
            patch_binary,
            TARGET=self.target,
            LEGACY_BACKUP=self.legacy_backup,
        )

    def test_newer_target_is_rejected_before_old_backup(self) -> None:
        self.target.write_bytes(b"newer-1.1.17")
        versioned_backup = self.root / "agy.zh-backup-1.1.16"
        versioned_backup.write_bytes(b"official-1.1.16")

        def fake_run(*args: str, check: bool = True):
            if args[:4] == ("codesign", "--verify", "--deep", "--strict"):
                return subprocess.CompletedProcess(args, 0, "", "")
            if args == (str(self.target), "--version"):
                return subprocess.CompletedProcess(args, 0, "1.1.17\n", "")
            raise AssertionError(f"unexpected command: {args}")

        with self.patch_paths(), mock.patch.object(patch_binary, "run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "1.1.17"):
                patch_binary.select_existing_source(self.manifest)

    def test_supported_adhoc_target_uses_versioned_pristine_backup(self) -> None:
        self.target.write_bytes(b"localized-1.1.16")
        versioned_backup = self.root / "agy.zh-backup-1.1.16"
        versioned_backup.write_bytes(b"official-1.1.16")

        def fake_run(*args: str, check: bool = True):
            if args[:4] == ("codesign", "--verify", "--deep", "--strict"):
                return subprocess.CompletedProcess(args, 0, "", "")
            if args == (str(self.target), "--version"):
                return subprocess.CompletedProcess(args, 0, "1.1.16\n", "")
            raise AssertionError(f"unexpected command: {args}")

        with (
            self.patch_paths(),
            mock.patch.object(patch_binary, "run", side_effect=fake_run),
            mock.patch.object(patch_binary, "signature_details", return_value="Signature=adhoc"),
            mock.patch.object(patch_binary, "validate_source") as validate_source,
        ):
            selected = patch_binary.select_existing_source(self.manifest)

        self.assertEqual(selected, versioned_backup)
        validate_source.assert_called_once_with(versioned_backup, self.manifest)

    def test_invalid_current_signature_requires_explicit_restore(self) -> None:
        self.target.write_bytes(b"damaged")
        versioned_backup = self.root / "agy.zh-backup-1.1.16"
        versioned_backup.write_bytes(b"official-1.1.16")
        failed = subprocess.CompletedProcess(("codesign",), 1, "", "invalid signature")

        with self.patch_paths(), mock.patch.object(patch_binary, "run", return_value=failed):
            with self.assertRaisesRegex(RuntimeError, "显式运行 --restore"):
                patch_binary.select_existing_source(self.manifest)


class ManifestContractTests(unittest.TestCase):
    def test_offsets_are_unique_and_translations_fit(self) -> None:
        manifest = json.loads((ROOT / "i18n" / "binary-translations.json").read_text())
        offsets = [int(item["offset"], 0) for item in manifest["patches"]]
        self.assertEqual(len(offsets), len(set(offsets)))
        for item in manifest["patches"]:
            self.assertLessEqual(
                len(item["zh"].encode("utf-8")),
                len(item["en"].encode("utf-8")),
                item["context"],
            )

    def test_settings_surface_has_labels_descriptions_and_display_values(self) -> None:
        manifest = json.loads((ROOT / "i18n" / "binary-translations.json").read_text())
        settings_items = {
            item["en"]: item for item in manifest["patches"]
            if item["context"].startswith("/settings")
        }

        labels = {
            "Agent Mode",
            "Animation Speed",
            "Artifact Review",
            "Color Scheme",
            "Copy on Select",
            "Editor",
            "Editor Mode",
            "Enable Telemetry",
            "Non-Workspace Access",
            "Notifications",
            "Rendering Mode",
            "Sandbox Mode",
            "Show Active Tasks",
            "Show Feedback Survey",
            "Show Tips",
            "Tool Permission",
            "Use AI Credits",
            "Verbosity",
        }
        descriptions = {
            item["context"] for item in manifest["patches"]
            if item["context"].startswith("/settings")
            and item["context"].endswith("说明")
            and "快捷键" not in item["context"]
        }

        self.assertTrue(labels.issubset(settings_items))
        self.assertEqual(len(descriptions), 17)
        self.assertIn("asks for review", settings_items)
        self.assertIn("native terminal (inline)", settings_items)
        self.assertIn("Save", settings_items)
        self.assertIn("Cancel", settings_items)

        config_tokens = {
            "default",
            "on",
            "off",
            "fast",
            "high",
            "always-proceed",
            "colorblind-friendly light",
        }
        self.assertTrue(config_tokens.isdisjoint(settings_items))

    def test_new_116_menu_descriptions_are_covered(self) -> None:
        manifest = json.loads((ROOT / "i18n" / "binary-translations.json").read_text())
        contexts = {item["context"] for item in manifest["patches"]}
        self.assertIn("/goal 命令说明", contexts)
        self.assertIn("/schedule 命令说明", contexts)
        self.assertIn("/migrate-workflows 技能说明", contexts)

        skill_manifest = json.loads((ROOT / "i18n" / "skill-translations.json").read_text())
        skill_paths = {item["path"] for item in skill_manifest["patches"]}
        self.assertIn("skills/migrate-workflows/SKILL.md", skill_paths)


if __name__ == "__main__":
    unittest.main()
