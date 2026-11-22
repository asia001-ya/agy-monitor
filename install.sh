#!/usr/bin/env bash
# agy-monitor macOS / Linux / Git Bash 一键部署脚本
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 Node.js 18 及以上版本：https://nodejs.org/" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/scripts/install.mjs" "$@"
