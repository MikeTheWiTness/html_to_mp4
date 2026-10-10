# Windows 本地旁白合成（System.Speech / SAPI）→ 分段音频，供 build.mjs --reuse-tts 使用。
#
#   powershell -ExecutionPolicy Bypass -File tts-win.ps1
#   powershell -ExecutionPolicy Bypass -File tts-win.ps1 -Voice "Microsoft Huihui Desktop"
#   powershell -ExecutionPolicy Bypass -File tts-win.ps1 -TargetDir "D:\课件\参考系"
#
# 为什么需要它：build.mjs 的第一步调用 macOS 的 say；Windows 没有 say，
# 所以先在这里按 script.json 的段序生成 work/segN.wav，再用项目里的 ffmpeg 转成
# work/segN.aiff（脚本按 .aiff 命名查找），最后跑：
#   node build.mjs --approved --reuse-tts
# 时长仍由 ffprobe 实测，音画同步公式不变。
param(
  [string]$TargetDir = $PSScriptRoot,
  [string]$Voice = '',
  [int]$Rate = 0,
  [string]$Ffmpeg = ''
)
$ErrorActionPreference = 'Stop'
$NL = [Environment]::NewLine

$scriptJson = Join-Path $TargetDir 'script.json'
if (-not (Test-Path $scriptJson)) { throw "找不到 $scriptJson（-TargetDir 指向项目目录）" }
$work = Join-Path $TargetDir 'work'
New-Item -ItemType Directory -Force -Path $work | Out-Null

if (-not $Ffmpeg) {
  foreach ($candidate in @((Join-Path $TargetDir 'tools\ffmpeg.exe'), (Join-Path $TargetDir 'ffmpeg.exe'))) {
    if (Test-Path $candidate) { $Ffmpeg = $candidate; break }
  }
}
if (-not $Ffmpeg -or -not (Test-Path $Ffmpeg)) {
  throw '找不到 tools\ffmpeg.exe：先跑 tools\install-tools.ps1（或 winget install Gyan.FFmpeg），再用 -Ffmpeg 指定路径'
}

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$installed = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })

if (-not $Voice) {
  $zh = $installed | Where-Object { $_.Culture.Name -like 'zh-*' } | Select-Object -First 1
  if (-not $zh) {
    $names = ($installed | ForEach-Object { $_.Name + '(' + $_.Culture.Name + ')' }) -join '、'
    throw "系统里没有中文（zh-*）人声，已装：$names$NL" +
          "请在「设置 → 时间和语言 → 语音 → 管理语音」里添加中文（简体，中国）声音（推荐 Microsoft Huihui），或改用 -Voice 指定。"
  }
  $Voice = $zh.Name
}
$synth.SelectVoice($Voice)
$synth.Rate = $Rate

Write-Host "使用人声：$Voice（rate=$Rate）"
$config = Get-Content -Raw -Encoding UTF8 $scriptJson | ConvertFrom-Json
$segments = @($config.segments)
if (-not $segments.Count) { throw 'script.json 里没有 segments' }

for ($i = 0; $i -lt $segments.Count; $i++) {
  $text = [string]$segments[$i].text
  $wav = Join-Path $work ("seg{0}.wav" -f $i)
  $aiff = Join-Path $work ("seg{0}.aiff" -f $i)
  if (Test-Path $wav) { Remove-Item -Force $wav }
  $synth.SetOutputToWaveFile($wav)
  $synth.Speak($text)
  $synth.SetOutputToNull()
  & $Ffmpeg -y -hide_banner -loglevel error -i $wav $aiff
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg 转换失败：$wav" }
  Write-Host ("  段 {0}  {1}" -f $i, $segments[$i].id)
}
$synth.Dispose()

Write-Host ""
Write-Host "已生成 $work\seg0..$($segments.Count - 1).aiff"
Write-Host "接着跑：node build.mjs --approved --reuse-tts"
Write-Host "（换人声/换语速后请重新跑本脚本；时长由 ffprobe 实测，无需手工改数字）"
