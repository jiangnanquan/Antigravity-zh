#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  "") exec python3 "$SCRIPT_DIR/patch_binary.py" ;;
  --dry-run|--restore|--status) exec python3 "$SCRIPT_DIR/patch_binary.py" "$1" ;;
  *)
    echo "用法: $0 [--dry-run|--status|--restore]" >&2
    exit 2
    ;;
esac
