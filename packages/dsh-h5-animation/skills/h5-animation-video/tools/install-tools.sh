#!/usr/bin/env bash
# 下载与本机架构匹配的静态 ffmpeg / ffprobe 到本目录（macOS / Linux）。
#
#   用法：./install-tools.sh [目标目录]
#         不给目标目录就装到脚本自身所在目录；给了就装到那里（doctor 会装到 <工作区>/tools）。
#   Windows：用同目录的 install-tools.ps1
#
#   内网/镜像：H5VIDEO_MIRROR=https://内网镜像/ffmpeg ./install-tools.sh <目标目录>
#   镜像目录按固定文件名提供，缺哪个就退回哪个的上游地址：
#     ffmpeg-darwin-arm64.gz / ffmpeg-darwin-x64.gz
#     ffprobe-darwin-arm64.tgz / ffprobe-darwin-x64.zip / ffprobe-darwin-arm64.zip
#     ffmpeg-release-arm64-static.tar.xz / ffmpeg-release-amd64-static.tar.xz
#
# 关键点：**实际跑一次 `-version` 来判断可用性**，不只看可执行位。
# x86_64 的 ffprobe 在没有 Rosetta 的 arm64 机器上也是「可执行」的，但一跑就
# `Bad CPU type in executable`——只检查文件存在的脚本会一直跳过它，把问题留给出片。
set -euo pipefail
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$SRC_DIR}"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

# 镜像优先：H5VIDEO_MIRROR 指向一个扁平目录，按固定文件名取包；没设就用上游。
mirror_url() {
  if [ -n "${H5VIDEO_MIRROR:-}" ]; then
    printf '%s/%s' "${H5VIDEO_MIRROR%/}" "$2"
  else
    printf '%s' "$1"
  fi
}
if [ -n "${H5VIDEO_MIRROR:-}" ]; then printf '%s\n' "使用镜像 ${H5VIDEO_MIRROR}" >&2; fi

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
  Darwin) PLATFORM=darwin ;;
  Linux)  PLATFORM=linux ;;
  *) echo "只支持 macOS / Linux；Windows 请用 tools/install-tools.ps1" >&2; exit 1 ;;
esac
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) echo "未知架构：$ARCH" >&2; exit 1 ;;
esac

# FFmpeg 6.1.1 的静态包（eugeneware/ffmpeg-static 的 release 资产）。
FFMPEG_TAG=b6.1.1
# @ffprobe-installer 的平台包：macOS arm64 上这才是真 arm64；evermeet.cx 只有 x86_64。
FFPROBE_NPM_VERSION=5.0.1

log() { printf '%s\n' "$*" >&2; }

# 文件存在、可执行，而且真的能跑起来。
works() {
  [ -x "$1" ] && "./$1" -version >/dev/null 2>&1
}

CURL_OPTS=(-fL --retry 3 --connect-timeout 20 --max-time 1800)
if [ "${H5_INSECURE_TLS:-}" = "1" ]; then
  CURL_OPTS+=(-k)
  log "注意：H5_INSECURE_TLS=1，已关闭证书校验——只在你信任当前网络代理时这么用"
fi

fetch() {
  log "下载 $1"
  if ! curl "${CURL_OPTS[@]}" -o "$2" "$1"; then
    log "下载失败：$1"
    log "若报 certificate has expired，先确认系统时钟是否准（时钟跑到未来会让所有证书看起来过期）；"
    log "若报 self signed certificate，说明网络里有 TLS 拦截代理，可临时 H5_INSECURE_TLS=1 重跑（自担风险），"
    log "或换来源：brew install ffmpeg / winget install Gyan.FFmpeg / 发行版包管理器。"
    return 1
  fi
}

linux_static_file="ffmpeg-release-$([ "$ARCH" = arm64 ] && echo arm64 || echo amd64)-static.tar.xz"
linux_static_url="$(mirror_url "https://johnvansickle.com/ffmpeg/releases/$linux_static_file" "$linux_static_file")"

download_ffmpeg() {
  case "$PLATFORM" in
    darwin)
      fetch "$(mirror_url "https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}/ffmpeg-darwin-${ARCH}.gz" "ffmpeg-darwin-${ARCH}.gz")" ffmpeg.gz
      gunzip -f ffmpeg.gz
      ;;
    linux)
      fetch "$linux_static_url" ffmpeg.tar.xz
      tar -xJf ffmpeg.tar.xz --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'
      rm -f ffmpeg.tar.xz
      ;;
  esac
  chmod +x ffmpeg
}

download_ffprobe() {
  case "$PLATFORM-$ARCH" in
    darwin-arm64)
      # evermeet.cx 只有 x86_64，arm64 必须另找来源。先试 npm 上的 @ffprobe-installer 平台包，
      # 拿不到再退回 osxexperts 的 arm64 静态包；两条路都会在下面做 -version 自检。
      if ! { fetch "$(mirror_url "https://registry.npmjs.org/@ffprobe-installer/darwin-arm64/-/darwin-arm64-${FFPROBE_NPM_VERSION}.tgz" "ffprobe-darwin-arm64.tgz")" ffprobe.tgz &&
             tar -xzf ffprobe.tgz package/ffprobe &&
             mv -f package/ffprobe ffprobe &&
             rm -rf ffprobe.tgz package; }; then
        rm -rf ffprobe.tgz package
        fetch "$(mirror_url "https://www.osxexperts.net/ffprobe9arm.zip" "ffprobe-darwin-arm64.zip")" ffprobe.zip
        unzip -o -q ffprobe.zip
        rm -f ffprobe.zip
      fi
      ;;
    darwin-x64)
      fetch "$(mirror_url "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip" "ffprobe-darwin-x64.zip")" ffprobe.zip
      unzip -o -q ffprobe.zip
      rm -f ffprobe.zip
      ;;
    linux-*)
      # johnvansickle 的静态包同时含 ffmpeg 与 ffprobe；上面若已解出来就不用再下。
      if [ ! -x ffprobe ]; then
        fetch "$linux_static_url" ffmpeg.tar.xz
        tar -xJf ffmpeg.tar.xz --strip-components=1 --wildcards '*/ffprobe'
        rm -f ffmpeg.tar.xz
      fi
      ;;
  esac
  chmod +x ffprobe 2>/dev/null || true
}

if works ffmpeg && works ffprobe; then
  log "ffmpeg / ffprobe 已就绪，跳过下载"
else
  # ffprobe 单独坏掉（架构不符、下载不完整）也要重来，不能因为文件在就跳过。
  if ! works ffmpeg; then
    download_ffmpeg
  elif [ "$PLATFORM" = linux ] && ! works ffprobe; then
    download_ffmpeg   # Linux 的静态包同时含 ffmpeg 与 ffprobe
  fi
  works ffprobe || download_ffprobe
fi

ok=1
works ffmpeg || { echo "ffmpeg 仍不可用：$PWD/ffmpeg" >&2; ok=0; }
works ffprobe || { echo "ffprobe 仍不可用：$PWD/ffprobe" >&2; ok=0; }
if [ "$ok" -ne 1 ]; then
  cat >&2 <<'EOF'
自检失败。按平台换来源：
  macOS arm64 : npm i @ffprobe-installer/darwin-arm64   （ffprobe-static 在 macOS 上只有 x86_64）
  macOS 任意  : brew install ffmpeg
  Linux       : 发行版包管理器，或用 johnvansickle 静态包
  Windows     : tools/install-tools.ps1 或 winget install Gyan.FFmpeg
EOF
  exit 1
fi

./ffmpeg -version | head -1
./ffprobe -version | head -1
log "完成：$(pwd)"
