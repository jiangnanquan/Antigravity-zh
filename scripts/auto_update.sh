#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

set +e
python3 scripts/prepare_upgrade.py --non-interactive --ai-packet --apply
prepare_status=$?
set -e

if [[ $prepare_status -eq 2 ]]; then
  echo "AUTO UPDATE PAUSED：请审查 .upgrade/ 中的短报告；处理后重新运行本命令"
  exit 2
fi
if [[ $prepare_status -ne 0 ]]; then
  exit "$prepare_status"
fi

python3 -m unittest discover -s tests -v
bash scripts/install.sh

echo "AUTO UPDATE PASS：机械继承、测试和安装已完成；发布前仍需真实 TUI 验收"
