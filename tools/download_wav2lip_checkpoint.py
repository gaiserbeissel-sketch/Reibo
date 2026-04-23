#!/usr/bin/env python3
"""下载 Wav2Lip 官方权重到 tools/Wav2Lip/checkpoints/wav2lip.pth（HF：numz/wav2lip_studio/Wav2lip/wav2lip.pth）。"""
from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

# 与 HF 网页「Files」一致；勿用根目录 wav2lip.pth（404）
URL = "https://huggingface.co/numz/wav2lip_studio/resolve/main/Wav2lip/wav2lip.pth"
DEST = Path(__file__).resolve().parent / "Wav2Lip" / "checkpoints" / "wav2lip.pth"


def main() -> int:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.is_file() and DEST.stat().st_size > 1_000_000:
        print(f"已存在：{DEST} ({DEST.stat().st_size} bytes)，跳过。")
        return 0
    proxy = (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or "").strip()
    print(f"下载到 {DEST} …")
    if proxy:
        print(f"使用代理：{proxy}")
    try:
        urllib.request.urlretrieve(URL, DEST)  # noqa: S310
    except Exception as e:  # noqa: BLE001
        print(f"失败：{e}", file=sys.stderr)
        print("请配置可访问 huggingface.co 的代理后重试，或手动下载：", file=sys.stderr)
        print(URL, file=sys.stderr)
        return 1
    print(f"完成：{DEST.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
