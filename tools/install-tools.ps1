# 下载 Windows 版静态 ffmpeg / ffprobe 到本目录（bin/）。
#
#   用法：powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1
#
# 与 install-tools.sh 同样的规矩：**实际跑一次 `-version` 来判断可用性**，
# 不只看文件在不在——架构不符或下载不完整的 exe 会被重新下载。
#
# 备注：TTS 仍需要 macOS 的 say；Windows 上的旁白方案见
# references/pipeline.md「平台支持」一节（用系统语音预生成 work/segN.aiff 再 --reuse-tts）。

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Test-Tool([string]$Name) {
  $path = Join-Path $PSScriptRoot $Name
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  try { & $path -version *> $null; return $true } catch { return $false }
}

if ((Test-Tool 'ffmpeg.exe') -and (Test-Tool 'ffprobe.exe')) {
  Write-Host 'ffmpeg / ffprobe 已就绪，跳过下载'
  & (Join-Path $PSScriptRoot 'ffmpeg.exe') -version | Select-Object -First 1
  exit 0
}

$zip = Join-Path $env:TEMP 'ffmpeg-release-essentials.zip'
$dir = Join-Path $env:TEMP 'ffmpeg-release-essentials'
if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }

Write-Host '下载 ffmpeg-release-essentials.zip（gyan.dev，内含 ffmpeg.exe 与 ffprobe.exe）'
if ($env:H5_INSECURE_TLS -eq '1') {
  Write-Warning '注意：H5_INSECURE_TLS=1，已关闭证书校验——只在你信任当前网络代理时这么用'
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}
Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force
Get-ChildItem -LiteralPath $dir -Recurse -Include 'ffmpeg.exe', 'ffprobe.exe' |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PSScriptRoot $_.Name) -Force }
Remove-Item -LiteralPath $dir -Recurse -Force

if (-not ((Test-Tool 'ffmpeg.exe') -and (Test-Tool 'ffprobe.exe'))) {
  Write-Error @'
下载完成但二进制仍无法运行。可改用：
  winget install Gyan.FFmpeg          （装完 PATH 上就有 ffmpeg / ffprobe）
  或从 https://www.gyan.dev/ffmpeg/builds/ 手动下载后，把 bin\ffmpeg.exe 与 bin\ffprobe.exe 放到本目录
'@
  exit 1
}

& (Join-Path $PSScriptRoot 'ffmpeg.exe') -version | Select-Object -First 1
& (Join-Path $PSScriptRoot 'ffprobe.exe') -version | Select-Object -First 1
Write-Host "完成：$PSScriptRoot"
