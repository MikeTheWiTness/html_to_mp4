#!/usr/bin/env bash
# 生成一个新的视频项目骨架（复制模板 + 挂上 tools/ 里的 ffmpeg）
# 用法: ./setup.sh <目标目录>
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DST="${1:-}"
if [ -z "$DST" ]; then
  echo "用法: $0 <目标目录>"
  exit 1
fi

mkdir -p "$DST/tools" "$DST/out" "$DST/work"

for f in animation.html build.mjs storyboard.cjs script.json qa-tts-audio.cjs tts-win.ps1; do
  if [ -f "$DST/$f" ]; then
    echo "跳过已存在: $f"
  else
    cp "$SRC/$f" "$DST/$f"
  fi
done

if [ -d "$SRC/vendor" ] && [ ! -d "$DST/vendor" ]; then
  cp -R "$SRC/vendor" "$DST/vendor"          # KaTeX（LaTeX 公式渲染）
fi

TOOL_SRC="$(cd "$SRC/.." && pwd)/tools"
for t in ffmpeg ffprobe; do
  if [ -x "$DST/tools/$t" ]; then
    continue
  elif [ -x "$TOOL_SRC/$t" ]; then
    ln -sf "$TOOL_SRC/$t" "$DST/tools/$t"
  else
    echo "警告: 没找到 $TOOL_SRC/$t（可先运行 tools/install-tools.sh）"
  fi
done

echo "已创建项目: $DST"
echo "两阶段流程:"
echo "  第一阶段  1) 编辑 $DST/script.json 写旁白"
echo "            2) 编辑 $DST/animation.html 写画面"
echo "            3) cd $DST && node storyboard.cjs   # 出分镜，交人工审核"
echo "  第二阶段  4) 审核通过后: node build.mjs --approved"
