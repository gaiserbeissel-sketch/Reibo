#!/usr/bin/env bash
# 在「与多乐后端同一台」服务器上安装 ComfyUI + ComfyUI-LivePortraitKJ（供步骤3 LivePortrait 调用）。
# 需：git、python3.10+、python3-venv；GPU 推理需本机 NVIDIA 驱动与匹配的 CUDA/PyTorch。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
COMFY="$ROOT/ComfyUI"
KJ="$COMFY/custom_nodes/ComfyUI-LivePortraitKJ"

if [[ ! -d "$COMFY" ]]; then
  echo "未找到 $COMFY，请先在此目录执行：git clone https://github.com/comfyanonymous/ComfyUI.git"
  exit 1
fi
if [[ ! -d "$KJ" ]]; then
  echo "未找到 $KJ，请执行：cd $COMFY/custom_nodes && git clone https://github.com/kijai/ComfyUI-LivePortraitKJ.git"
  exit 1
fi

cd "$COMFY"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt
pip install -r "$KJ/requirements.txt" || {
  echo "提示：若与 ComfyUI 的 numpy 版本冲突，可尝试：pip install 'numpy<=1.26.4' -r $KJ/requirements.txt"
  exit 1
}

echo ""
echo "安装完成。后端 .env 示例（路径请按实际修改）："
echo "  COMFYUI_INSTALL_ROOT=$COMFY"
echo "  COMFYUI_BASE_URL=http://127.0.0.1:8188"
echo ""
echo "启动 ComfyUI（监听局域网，便于浏览器调试）："
echo "  cd $COMFY && source .venv/bin/activate && python main.py --listen 0.0.0.0 --port 8188"
echo ""
echo "模型请放入 ComfyUI/models/liveportrait（或插件说明目录），并在浏览器导出 API 工作流后配置 COMFYUI_LIVEPORTRAIT_WORKFLOW_PATH 与节点 ID。"
