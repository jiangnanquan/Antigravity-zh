#!/usr/bin/env python3
"""Apply a version-locked, exact-offset localization patch to AGY."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile


TARGET = Path.home() / ".local" / "bin" / "agy"
BACKUP = TARGET.with_name(f"{TARGET.name}.zh-backup")
MANIFEST = Path(__file__).resolve().parent.parent / "i18n" / "binary-translations.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, text=True, capture_output=True)


def load_manifest() -> dict:
    with MANIFEST.open(encoding="utf-8") as handle:
        return json.load(handle)


def validate_source(path: Path, manifest: dict) -> None:
    actual_platform = f"{sys.platform}-{platform.machine()}"
    if actual_platform != manifest["_meta"]["platform"]:
        raise RuntimeError(
            f"平台不匹配：检测到 {actual_platform}，仅支持 {manifest['_meta']['platform']}"
        )
    expected_hash = manifest["_meta"]["sha256"]
    actual_hash = sha256(path)
    if actual_hash != expected_hash:
        raise RuntimeError(
            f"版本锁校验失败：{path} 的 SHA-256 为 {actual_hash}，期望 {expected_hash}"
        )
    version = run(str(path), "--version").stdout.strip()
    if version != manifest["_meta"]["agy_version"]:
        raise RuntimeError(f"版本不匹配：检测到 {version}，仅支持 {manifest['_meta']['agy_version']}")
    run("codesign", "--verify", "--deep", "--strict", str(path))


def patch_bytes(source: Path, destination: Path, manifest: dict) -> None:
    data = bytearray(source.read_bytes())
    for item in manifest["patches"]:
        offset = int(item["offset"], 0)
        original = item["en"].encode("utf-8")
        translated = item["zh"].encode("utf-8")
        if len(translated) > len(original):
            raise RuntimeError(f"翻译过长：{item['context']} ({len(translated)} > {len(original)})")
        actual = bytes(data[offset : offset + len(original)])
        if actual != original:
            raise RuntimeError(
                f"偏移校验失败 {item['offset']} ({item['context']})："
                f"读取到 {actual!r}，期望 {original!r}"
            )
        data[offset : offset + len(original)] = translated.ljust(len(original), b" ")
    destination.write_bytes(data)
    destination.chmod(0o755)


def verify_patched(path: Path, manifest: dict) -> None:
    run("codesign", "--verify", "--deep", "--strict", str(path))
    version = run(str(path), "--version").stdout.strip()
    if version != manifest["_meta"]["agy_version"]:
        raise RuntimeError(f"补丁后版本冒烟失败：{version!r}")
    help_result = run(str(path), "--help")
    help_text = help_result.stdout + help_result.stderr
    if "可用子命令：" not in help_text:
        raise RuntimeError("补丁后帮助文本未出现中文标题")
    data = path.read_bytes()
    for item in manifest["patches"]:
        offset = int(item["offset"], 0)
        expected = item["zh"].encode("utf-8")
        if data[offset : offset + len(expected)] != expected:
            raise RuntimeError(f"补丁验收失败：{item['context']}")


def select_source(manifest: dict) -> Path:
    """Choose the pristine source without overwriting a newer official AGY."""
    expected_hash = manifest["_meta"]["sha256"]
    if TARGET.exists() and sha256(TARGET) == expected_hash:
        return TARGET
    if not TARGET.exists():
        return BACKUP

    signature = run("codesign", "--verify", "--deep", "--strict", str(TARGET), check=False)
    if signature.returncode != 0:
        # Recovery path for the old unsafe patch whose invalid signature caused
        # macOS to SIGKILL agy before it could print a version.
        return BACKUP

    version = run(str(TARGET), "--version").stdout.strip()
    if version != manifest["_meta"]["agy_version"]:
        raise RuntimeError(
            f"检测到新的官方或未知 agy 版本 {version!r}；拒绝使用旧备份覆盖，请先更新偏移表"
        )
    details = run("codesign", "-dvvv", str(TARGET), check=False)
    signature_details = details.stdout + details.stderr
    if "Signature=adhoc" in signature_details:
        return BACKUP
    raise RuntimeError(
        "当前 agy 是同版本但 SHA-256 未识别的正式签名文件；拒绝使用旧备份覆盖"
    )


def apply_patch(dry_run: bool) -> None:
    manifest = load_manifest()
    source = select_source(manifest)
    if not source.exists():
        raise RuntimeError("找不到与当前版本匹配的官方二进制或备份")
    validate_source(source, manifest)

    if dry_run:
        with tempfile.TemporaryDirectory(prefix="antigravity-zh-") as temp_dir:
            staged = Path(temp_dir) / "agy"
            patch_bytes(source, staged, manifest)
        print(f"DRY-RUN PASS：{len(manifest['patches'])} 条精确偏移全部匹配")
        return

    if not BACKUP.exists():
        shutil.copy2(source, BACKUP)
    validate_source(BACKUP, manifest)

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, staged_name = tempfile.mkstemp(prefix="agy.zh-staged-", dir=TARGET.parent)
    os.close(file_descriptor)
    staged = Path(staged_name)
    try:
        patch_bytes(BACKUP, staged, manifest)
        run("codesign", "--force", "--sign", "-", "--options", "runtime", str(staged))
        verify_patched(staged, manifest)
        os.replace(staged, TARGET)
    finally:
        staged.unlink(missing_ok=True)
    print(f"PATCH PASS：已应用 {len(manifest['patches'])} 条精确汉化并完成 ad-hoc 签名")


def restore() -> None:
    manifest = load_manifest()
    validate_source(BACKUP, manifest)
    file_descriptor, staged_name = tempfile.mkstemp(prefix="agy.zh-restore-", dir=TARGET.parent)
    os.close(file_descriptor)
    staged = Path(staged_name)
    try:
        shutil.copy2(BACKUP, staged)
        os.replace(staged, TARGET)
    finally:
        staged.unlink(missing_ok=True)
    validate_source(TARGET, manifest)
    print("RESTORE PASS：已恢复 Google 原签名 agy")


def status() -> None:
    manifest = load_manifest()
    expected_hash = manifest["_meta"]["sha256"]
    if not TARGET.exists():
        raise RuntimeError(f"找不到 {TARGET}")
    current_hash = sha256(TARGET)
    if current_hash == expected_hash:
        validate_source(TARGET, manifest)
        print("状态：官方原版（Google 签名）")
        return
    verification = run("codesign", "--verify", "--deep", "--strict", str(TARGET), check=False)
    if verification.returncode != 0:
        print("状态：签名无效，agy 会被 macOS 杀死")
        sys.exit(1)
    try:
        verify_patched(TARGET, manifest)
    except RuntimeError as error:
        print(f"状态：未知的已签名二进制（{error}）")
        sys.exit(1)
    print("状态：精确偏移汉化版（ad-hoc hardened runtime 签名）")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--restore", action="store_true")
    group.add_argument("--status", action="store_true")
    args = parser.parse_args()
    if args.restore:
        restore()
    elif args.status:
        status()
    else:
        apply_patch(args.dry_run)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"错误：{error}", file=sys.stderr)
        sys.exit(1)
