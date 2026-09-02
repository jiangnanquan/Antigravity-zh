#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:---apply}"

case "$MODE" in
  --apply|--check|--check-original|--restore|--preset) ;;
  *)
    echo "用法: $0 [--apply|--check|--check-original|--restore|--preset]" >&2
    exit 2
    ;;
esac

exec node "$SCRIPT_DIR/patch_hud.js" "$MODE"
