#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGY_BIN="${AGY_BIN:-$HOME/.local/bin/agy}"
HUD_BIN="$HOME/.gemini/antigravity-cli/agy-hud-runtime/runtime/bin/agy-hud.js"

echo "[1/7] 检查 HUD 已恢复原版"
bash "$SCRIPT_DIR/patch_hud.sh" --check-original

echo "[2/7] 检查内置 Skill 说明汉化状态"
bash "$SCRIPT_DIR/patch_skill_descriptions.sh" --check

echo "[3/7] 检查二进制汉化状态"
bash "$SCRIPT_DIR/patch_binary.sh" --status

echo "[4/7] 校验 macOS 签名"
codesign --verify --deep --strict "$AGY_BIN"

echo "[5/7] 校验版本启动"
test "$($AGY_BIN --version)" = "1.1.13"

echo "[6/7] 校验帮助文本"
HELP_OUTPUT="$("$AGY_BIN" --help 2>&1)"
grep -q "可用子命令：" <<<"$HELP_OUTPUT"

echo "[7/7] 校验真实 HUD 保持英文原版"
test -f "$HUD_BIN"
HUD_OUTPUT="$(printf '' | node "$HUD_BIN")"
printf '%s' "$HUD_OUTPUT" | grep -q "Tokens"
printf '%s' "$HUD_OUTPUT" | grep -q "in:"
if printf '%s' "$HUD_OUTPUT" | grep -q "令牌"; then
  echo "HUD 仍含旧汉化文本" >&2
  exit 1
fi

echo "SMOKE PASS：agy 主体汉化可用，HUD 保持原版"
