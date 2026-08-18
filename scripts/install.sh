#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/5] 确认 HUD 保持原版"
bash "$SCRIPT_DIR/patch_hud.sh" --check-original

echo "[2/5] 预检 AGY 版本与全部精确偏移"
bash "$SCRIPT_DIR/patch_binary.sh" --dry-run

echo "[3/5] 安装 AGY 主体汉化"
bash "$SCRIPT_DIR/patch_binary.sh"

echo "[4/5] 安装内置 Skill 菜单说明汉化"
bash "$SCRIPT_DIR/patch_skill_descriptions.sh"

echo "[5/5] 运行完整冒烟验收"
bash "$SCRIPT_DIR/smoke_test.sh"
