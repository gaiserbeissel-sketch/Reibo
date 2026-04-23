#!/usr/bin/env bash
# npm run dev：先释放 Vite 常用端口再启动（与仓库根 start_frontend.sh 一致）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR="$(node -p "parseInt(process.versions.node,10)" 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "错误: 当前 Node 为 $(node -v 2>/dev/null || echo 未知)，Vite 6 需要 Node >= 18（建议 20 LTS）。"
  echo "若已安装 nvm: 在 frontend 目录执行  nvm install && nvm use"
  exit 1
fi

for port in 5173 5174 5175; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -15 2>/dev/null || true
    echo "已尝试释放端口 $port"
  fi
done
sleep 0.5

exec "$ROOT/node_modules/.bin/vite" "$@"
