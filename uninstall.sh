#!/usr/bin/env bash
# agy-monitor macOS / Linux / Git Bash 一键卸载脚本
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，无法执行卸载脚本。" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/scripts/uninstall.mjs" "$@"
