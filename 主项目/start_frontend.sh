#!/usr/bin/env bash
# 前端启动（macOS / Linux）：与仓库根相对路径固定
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "未找到 frontend 目录: $FRONTEND_DIR"
  exit 1
fi

echo "== 前端启动器 =="
echo "目录: $FRONTEND_DIR"

for port in 5173 5174 5175; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -15 2>/dev/null || true
    echo "已尝试释放端口 $port"
  fi
done
sleep 1

cd "$FRONTEND_DIR"
exec npm run dev
