#!/bin/bash
# Ubuntu / Debian 后端开发启动：创建或复用 backend/.venv、安装依赖、释放 8000、启动 uvicorn --reload。
# 用法：chmod +x start_backend.sh && ./start_backend.sh
#   或：bash start_backend.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "未找到 backend 目录: $BACKEND_DIR"
  if [ -t 0 ]; then read -r -p "按回车退出…" _; fi
  exit 1
fi

cd "$BACKEND_DIR"
echo "== 后端启动（Ubuntu/Linux）=="
echo "目录: $BACKEND_DIR"

choose_system_python() {
  # 服务端常见：系统 Python
  if [ "$(uname -s)" = Linux ]; then
    for p in /usr/bin/python3.12 /usr/bin/python3.11 /usr/bin/python3.10 /usr/bin/python3; do
      if [ -x "$p" ]; then
        echo "$p"
        return 0
      fi
    done
  fi
  for p in /usr/local/bin/python3.11 /usr/local/bin/python3.12 /usr/local/bin/python3.10 /usr/bin/python3; do
    if [ -x "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  command -v python3 || true
}

python_mm() {
  "$1" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true
}

is_supported_py() {
  case "$1" in
    3.9|3.10|3.11|3.12) return 0 ;;
    *) return 1 ;;
  esac
}

RECREATE_VENV=0
if [ -x "$BACKEND_DIR/.venv/bin/python3" ]; then
  PY="$BACKEND_DIR/.venv/bin/python3"
  MM="$(python_mm "$PY")"
  if ! is_supported_py "$MM"; then
    echo "检测到 .venv Python 版本不兼容: $MM，准备重建 .venv"
    RECREATE_VENV=1
  fi
elif [ -x "$BACKEND_DIR/venv/bin/python3" ]; then
  PY="$BACKEND_DIR/venv/bin/python3"
else
  PY="$(choose_system_python)"
fi

if [ -z "${PY:-}" ]; then
  echo "未找到 python3，请先: sudo apt install python3 python3-pip python3-venv"
  if [ -t 0 ]; then read -r -p "按回车退出…" _; fi
  exit 1
fi

if [ "$RECREATE_VENV" -eq 1 ]; then
  rm -rf "$BACKEND_DIR/.venv"
fi

if [ "$RECREATE_VENV" -eq 1 ] || { [ ! -x "$BACKEND_DIR/.venv/bin/python3" ] && [ ! -x "$BACKEND_DIR/venv/bin/python3" ]; }; then
  BASE_PY="$(choose_system_python)"
  BASE_MM="$(python_mm "$BASE_PY")"
  if ! is_supported_py "$BASE_MM"; then
    echo "当前可用 Python 版本为 $BASE_MM，不兼容本项目依赖（需要 3.9~3.12）。"
    if [ -t 0 ]; then read -r -p "按回车退出…" _; fi
    exit 1
  fi
  echo "使用 $BASE_PY 创建 .venv (Python $BASE_MM) …"
  if ! "$BASE_PY" -m venv .venv 2>/dev/null; then
    echo "python3 -m venv 失败（常见于未装 python3-venv）。尝试 virtualenv …"
    if command -v virtualenv >/dev/null 2>&1; then
      virtualenv .venv
    elif [ -x "${HOME}/.local/bin/virtualenv" ]; then
      "${HOME}/.local/bin/virtualenv" .venv
    else
      echo "请安装其一: sudo apt install python3-venv   或   pip install --user virtualenv"
      if [ -t 0 ]; then read -r -p "按回车退出…" _; fi
      exit 1
    fi
  fi
  PY="$BACKEND_DIR/.venv/bin/python3"
fi

echo "使用 Python: $PY"
echo "检查并安装后端依赖…"
"$PY" -m pip install -r requirements.txt

if [ "$(uname -s)" = Linux ] && command -v fuser >/dev/null 2>&1; then
  fuser -k 8000/tcp 2>/dev/null && echo "已用 fuser 释放 8000" || true
elif command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -nP -iTCP:8000 -sTCP:LISTEN -t 2>/dev/null || lsof -ti :8000 2>/dev/null || true); do
    echo "结束占用 8000 相关进程: $pid"
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.3
fi

echo "启动后端: uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
echo "健康检查: http://127.0.0.1:8000/api/health"
exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
