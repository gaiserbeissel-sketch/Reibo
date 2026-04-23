#!/usr/bin/env bash
# GStreamer NVCODEC 插件探测（可选方案 B）；结果写入 gpu_compose_benchmark_last.txt 同目录 gstreamer_nvcodec_inspect_last.txt
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/gstreamer_nvcodec_inspect_last.txt"
{
  echo "date=$(date -Iseconds)"
  echo "gst-inspect-1.0=$(command -v gst-inspect-1.0 2>/dev/null || echo MISSING)"
  echo ""
  for el in nvh264dec nvh264enc nvcompositor nvvidconv; do
    echo "========== ${el} =========="
    gst-inspect-1.0 "$el" 2>&1 || echo "(not found)"
    echo ""
  done
} | tee "$OUT"
echo "Wrote $OUT"
