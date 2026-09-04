#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HUD_DIR="$REPO_ROOT/hud"

if [ ! -d "$HUD_DIR" ]; then
  echo "错误: 未找到内置 HUD 目录 $HUD_DIR" >&2
  exit 1
fi

echo "[1/3] 从项目内置源码部署 agy-hud 运行时..."
AGY_HUD_SETUP_SOURCE_DIR="$HUD_DIR" node "$HUD_DIR/scripts/bootstrap.js"

echo "[2/3] 应用最终显示配置..."
HUD_RUNTIME_DIR="$HOME/.gemini/antigravity-cli/agy-hud-runtime/runtime"
if [ -d "$HUD_RUNTIME_DIR" ] && [ -f "$REPO_ROOT/presets/agy-hud.config.json" ]; then
  cp -f "$REPO_ROOT/presets/agy-hud.config.json" "$HUD_RUNTIME_DIR/agy-hud.config.json"
fi

echo "[3/3] 验证 HUD 渲染状态..."
if [ -f "$HUD_RUNTIME_DIR/bin/agy-hud.js" ]; then
  node "$HUD_RUNTIME_DIR/bin/agy-hud.js"
fi

echo "内置 agy-hud 安装与配置成功！"
