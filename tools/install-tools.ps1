# 下载 Windows 版静态 ffmpeg / ffprobe 到目标目录。
#
#   用法：powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1 [-TargetDir <目录>]
#         默认装到脚本所在目录；doctor 会带 -TargetDir 装到 <工作区>\tools。
#
#   内网/镜像：设置环境变量 H5VIDEO_MIRROR = https://内网镜像/ffmpeg
#             镜像目录需提供固定文件名 ffmpeg-release-essentials.zip（缺就用上游 gyan.dev）。
#
# 与 install-tools.sh 同样的规矩：实际跑一次 -version 来判断可用性，
# 不只看文件在不在——架构不符或下载不完整的 exe 会被重新下载。
#
# 备注：Windows 的旁白不走 say，用同目录的 tts-win.ps1（SAPI 本地合成）先生成
# work\segN.aiff，再 build.mjs --approved --reuse-tts。
param(
  [string]$TargetDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $TargetDir)) { New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null }
$TargetDir = (Resolve-Path -LiteralPath $TargetDir).Path
Set-Location -LiteralPath $TargetDir

function Test-Tool([string]$Name) {
  $path = Join-Path $TargetDir $Name
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  try { & $path -version *> $null; return $true } catch { return $false }
}

if ((Test-Tool 'ffmpeg.exe') -and (Test-Tool 'ffprobe.exe')) {
  Write-Host 'ffmpeg / ffprobe 已就绪，跳过下载'
  & (Join-Path $TargetDir 'ffmpeg.exe') -version | Select-Object -First 1
  exit 0
}

$zipName = 'ffmpeg-release-essentials.zip'
if ($env:H5VIDEO_MIRROR) {
  $url = $env:H5VIDEO_MIRROR.TrimEnd('/') + '/' + $zipName
  Write-Host "使用镜像：$url"
} else {
  $url = 'https://www.gyan.dev/ffmpeg/builds/' + $zipName
}

$zip = Join-Path $env:TEMP $zipName
$dir = Join-Path $env:TEMP 'ffmpeg-release-essentials'
if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }

Write-Host "下载 $zipName（含 ffmpeg.exe 与 ffprobe.exe）"
if ($env:H5_INSECURE_TLS -eq '1') {
  Write-Warning 'H5_INSECURE_TLS=1：已关闭证书校验，只在你信任当前网络代理时这么用'
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force
Get-ChildItem -LiteralPath $dir -Recurse -Include 'ffmpeg.exe', 'ffprobe.exe' |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $TargetDir $_.Name) -Force }
Remove-Item -LiteralPath $dir -Recurse -Force

if (-not ((Test-Tool 'ffmpeg.exe') -and (Test-Tool 'ffprobe.exe'))) {
  Write-Error @"
下载完成但二进制仍无法运行。可改用：
  winget install Gyan.FFmpeg          （装完 PATH 上就有 ffmpeg / ffprobe）
  或从 https://www.gyan.dev/ffmpeg/builds/ 手动下载后，把 bin\ffmpeg.exe 与 bin\ffprobe.exe 放到 $TargetDir
  内网可先设置环境变量 H5VIDEO_MIRROR 指向放有 $zipName 的镜像目录，再重跑本脚本
"@
  exit 1
}

& (Join-Path $TargetDir 'ffmpeg.exe') -version | Select-Object -First 1
& (Join-Path $TargetDir 'ffprobe.exe') -version | Select-Object -First 1
Write-Host "完成：$TargetDir"
