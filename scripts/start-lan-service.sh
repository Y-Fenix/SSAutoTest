#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p logs

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20+。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm。请检查 Node.js 安装是否完整。"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  npm ci
fi

if [ ! -d "dist" ]; then
  npm run build
fi

exec ./node_modules/.bin/vite preview --host 0.0.0.0 --port 5173
