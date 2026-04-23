#!/usr/bin/env bash
# 供「多乐AI-后端启动.desktop」调用：定位仓库根目录后执行 start_backend.sh（勿单独移动本文件到项目外）。
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$ROOT"
exec ./start_backend.sh
