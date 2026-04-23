#!/usr/bin/env python3
"""
步骤4 GPU 基线：对比 CPU 解码 vs -hwaccel cuda vs CUDA 缩放 + NVENC。
样本：工作区 .data/video 下首个足够大的 .mp4。结果写入同目录 gpu_compose_benchmark_last.txt。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

DURATION = "4"


def _workspace_data_video() -> Path:
    # tools/ -> 0401多了AI-主 -> 0401多乐Ai
    return Path(__file__).resolve().parents[2] / ".data" / "video"


def _find_sample() -> Path | None:
    d = _workspace_data_video()
    if not d.is_dir():
        return None
    for p in sorted(d.glob("*.mp4")):
        try:
            if p.is_file() and p.stat().st_size > 4096:
                return p
        except OSError:
            continue
    return None


def _run(name: str, cmd: list[str]) -> tuple[str, int, float, str]:
    t0 = time.perf_counter()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        dt = time.perf_counter() - t0
        tail = ((p.stderr or "") + (p.stdout or ""))[-500:]
        return name, p.returncode, dt, tail
    except subprocess.TimeoutExpired:
        return name, -1, 180.0, "timeout"


def main() -> int:
    ffmpeg = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
    sample = _find_sample()
    out_path = Path(__file__).resolve().parent / "gpu_compose_benchmark_last.txt"
    lines: list[str] = []
    lines.append(f"ffmpeg={ffmpeg}")
    if sample is None:
        lines.append("sample_mp4=MISSING (.data/video/*.mp4)")
        out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return 1
    lines.append(f"sample_mp4={sample}")
    lines.append(f"duration_sec={DURATION}")
    lines.append("")

    # A: 默认（常解码于 CPU）+ libavfilter scale + nvenc
    cmd_a = [
        ffmpeg,
        "-hide_banner",
        "-nostats",
        "-y",
        "-i",
        str(sample),
        "-t",
        DURATION,
        "-vf",
        "scale=1280:720",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-f",
        "null",
        "-",
    ]
    # B: NVDEC 解码（帧常回 CPU 做 scale）+ nvenc
    cmd_b = [
        ffmpeg,
        "-hide_banner",
        "-nostats",
        "-y",
        "-hwaccel",
        "cuda",
        "-i",
        str(sample),
        "-t",
        DURATION,
        "-vf",
        "scale=1280:720",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-f",
        "null",
        "-",
    ]
    # C: 解码与缩放尽量在 GPU（需 FFmpeg 支持 scale_cuda）
    cmd_c = [
        ffmpeg,
        "-hide_banner",
        "-nostats",
        "-y",
        "-hwaccel",
        "cuda",
        "-hwaccel_output_format",
        "cuda",
        "-i",
        str(sample),
        "-t",
        DURATION,
        "-vf",
        "scale_cuda=1280:720",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-f",
        "null",
        "-",
    ]

    for cmd, label in (
        (cmd_a, "A_cpu_decode_sw_scale_nvenc"),
        (cmd_b, "B_hwaccel_cuda_sw_scale_nvenc"),
        (cmd_c, "C_cuda_frames_scale_cuda_nvenc"),
    ):
        name, code, dt, tail = _run(label, cmd)
        lines.append(f"{name}  exit={code}  time_sec={dt:.3f}")
        if code != 0:
            lines.append(f"  tail: {tail.strip()[:400]}")
        lines.append("")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(out_path.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
