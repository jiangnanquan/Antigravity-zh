#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGY_BIN="${AGY_BIN:-$HOME/.local/bin/agy}"
HUD_BIN="$HOME/.gemini/antigravity-cli/agy-hud-runtime/runtime/bin/agy-hud.js"
MANIFEST="$SCRIPT_DIR/../i18n/binary-translations.json"
EXPECTED_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["_meta"]["agy_version"])' "$MANIFEST")"
EXPECTED_HASH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["_meta"]["sha256"])' "$MANIFEST")"
VERSIONED_BACKUP="$HOME/.local/bin/agy.zh-backup-$EXPECTED_VERSION"

echo "[1/8] 检查 HUD 已恢复原版"
bash "$SCRIPT_DIR/patch_hud.sh" --check-original

echo "[2/8] 检查内置 Skill 说明汉化状态"
bash "$SCRIPT_DIR/patch_skill_descriptions.sh" --check

echo "[3/8] 检查二进制汉化状态"
bash "$SCRIPT_DIR/patch_binary.sh" --status

echo "[4/8] 校验 macOS 签名"
codesign --verify --deep --strict "$AGY_BIN"

echo "[5/8] 校验版本启动"
test "$($AGY_BIN --version)" = "$EXPECTED_VERSION"

echo "[6/8] 校验按版本保存的 Google 原签名备份"
test -f "$VERSIONED_BACKUP"
test "$(shasum -a 256 "$VERSIONED_BACKUP" | cut -d' ' -f1)" = "$EXPECTED_HASH"
codesign --verify --deep --strict "$VERSIONED_BACKUP"
BACKUP_SIGNATURE="$(codesign -dv --verbose=4 "$VERSIONED_BACKUP" 2>&1)"
grep -q "Authority=Developer ID Application: Google LLC (EQHXZ8M8AV)" <<<"$BACKUP_SIGNATURE"

echo "[7/8] 校验帮助文本"
HELP_OUTPUT="$("$AGY_BIN" --help 2>&1)"
grep -q "可用子命令：" <<<"$HELP_OUTPUT"

echo "[8/8] 校验真实 HUD 保持英文原版"
test -f "$HUD_BIN"
HUD_OUTPUT="$(printf '' | node "$HUD_BIN")"
printf '%s' "$HUD_OUTPUT" | grep -q "Tokens"
printf '%s' "$HUD_OUTPUT" | grep -q "in:"
if printf '%s' "$HUD_OUTPUT" | grep -q "令牌"; then
  echo "HUD 仍含旧汉化文本" >&2
  exit 1
fi

echo "SMOKE PASS：agy 主体汉化可用，HUD 保持原版"
