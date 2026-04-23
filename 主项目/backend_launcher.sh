#!/bin/bash
# 多乐 AI 后端：先结束旧进程（本项目的 uvicorn / 占用端口）再启动；不每次 pip install。
# 首次安装依赖请运行同目录: bash start_backend.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
PORT="${BACKEND_PORT:-8000}"
# 仅本机浏览器：默认 127.0.0.1。若用局域网 IP 打开前端（如 http://192.168.x.x:5173），请改为监听全部网卡：
#   BACKEND_HOST=0.0.0.0 ./backend_launcher.sh
HOST="${BACKEND_HOST:-127.0.0.1}"

# 结束可能残留的本项目 uvicorn（含其它终端里以前台方式起的实例）
kill_old_uvicorn() {
  echo "→ 尝试结束旧的后端进程（uvicorn app.main）…"
  # [u] 避免匹配到 grep/pkill 自身
  pkill -f -TERM "[u]vicorn.*app\.main:app" 2>/dev/null && echo "  已发送 SIGTERM 给匹配的 uvicorn" || true
  pkill -f -TERM "[p]ython.*-m uvicorn.*app\.main" 2>/dev/null && echo "  已发送 SIGTERM 给 python -m uvicorn" || true
  sleep 0.4
}

kill_port() {
  local p="$1"
  if [ "$(uname -s)" = Linux ] && command -v fuser >/dev/null 2>&1; then
    if fuser -k "${p}/tcp" 2>/dev/null; then
      echo "已用 fuser 释放端口 ${p}"
    else
      echo "端口 ${p} 上无监听进程（或无需结束）"
    fi
  elif command -v lsof >/dev/null 2>&1; then
    local any=0
    for pid in $(lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null || true); do
      echo "结束监听 ${p} 的进程: $pid"
      kill "$pid" 2>/dev/null || true
      any=1
    done
    if [ "$any" -eq 0 ]; then
      echo "端口 ${p} 上未检测到监听进程（lsof）"
    fi
    sleep 0.3
  else
    echo "提示: 未安装 fuser/lsof，无法自动杀端口。若启动失败请手动结束占用 ${p} 的进程。"
  fi
}

if [ ! -d "$BACKEND_DIR" ]; then
  echo "未找到目录: $BACKEND_DIR"
  if [ -t 0 ]; then read -r -p "按回车退出…" _; fi
  exit 1
fi

if [ -x "$BACKEND_DIR/.venv/bin/python3" ]; then
  PY="$BACKEND_DIR/.venv/bin/python3"
elif [ -x "$BACKEND_DIR/venv/bin/python3" ]; then
  PY="$BACKEND_DIR/venv/bin/python3"
else
  echo "未找到 backend/.venv 或 backend/venv。"
  echo "请先在同目录执行一次: bash start_backend.sh（创建环境并安装依赖）"
  if [ -t 0 ]; then read -r -p "按回车退出…" _; fi
  exit 1
fi

cd "$BACKEND_DIR"
echo "========================================"
echo "  多乐 AI 后端启动器（结束旧进程 → 启动）"
echo "========================================"
echo "目录: $BACKEND_DIR"
echo "Python: $PY"
echo ""

kill_old_uvicorn
kill_port "$PORT"

echo ""
echo "启动: uvicorn app.main:app --host $HOST --port $PORT --reload"
echo "健康检查: http://${HOST}:${PORT}/api/health"
echo ""

exec "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
