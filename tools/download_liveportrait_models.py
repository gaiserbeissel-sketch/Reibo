#!/usr/bin/env python3
"""
将 Kijai/LivePortrait_safetensors 主文件下载到 ComfyUI/models/liveportrait。
用法（在仓库根或 tools 下均可）：
  python3 tools/download_liveportrait_models.py
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

REPO = "https://huggingface.co/Kijai/LivePortrait_safetensors/resolve/main"
FILES = [
    "appearance_feature_extractor.safetensors",
    "motion_extractor.safetensors",
    "spade_generator.safetensors",
    "stitching_retargeting_module.safetensors",
    "warping_module.safetensors",
    "landmark_model.pth",
    "landmark.onnx",
]


def main() -> int:
    root = Path(__file__).resolve().parent / "ComfyUI"
    dest = root / "models" / "liveportrait"
    dest.mkdir(parents=True, exist_ok=True)
    log = Path(__file__).resolve().parent / "download_liveportrait_models.log"
    lines: list[str] = []
    for name in FILES:
        url = f"{REPO}/{name}"
        out = dest / name
        if out.is_file() and out.stat().st_size > 10000:
            lines.append(f"skip exists: {out} ({out.stat().st_size} bytes)")
            continue
        lines.append(f"downloading {name} ...")
        log.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            urllib.request.urlretrieve(url, out)  # noqa: S310
        except Exception as e:  # noqa: BLE001
            lines.append(f"FAIL {name}: {e}")
            log.write_text("\n".join(lines) + "\n", encoding="utf-8")
            return 1
        lines.append(f"ok {name} -> {out.stat().st_size} bytes")
        log.write_text("\n".join(lines) + "\n", encoding="utf-8")
    lines.append("done.")
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
