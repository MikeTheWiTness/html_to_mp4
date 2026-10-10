// TTS 音色体检：出片前验证 say / SAPI 生成的语音有没有「丢块 / 硬切」（听感就是卡顿）。
//
//   node qa-tts-audio.cjs work/seg0.aiff work/seg3.aiff ...
//   node qa-tts-audio.cjs work/seg*.aiff          # 全部段落
//
// 两个判据：
//   zeroRuns  完全为 0 的样本段（>=10ms）—— 神经音色丢块的典型指纹
//   hardCuts  凹陷前一刻仍是满幅、凹陷深度达 1% 以下的 80~600ms 空白 —— 硬切
// 自然停顿（逗号、塞音闭塞）是渐进衰减的，不会同时满足「满幅 → 1% 以下 → 立即回满幅」。
//
// 参考基线（实测，同一句话）：
//   Tingting / Meijia（compact）                                    0 处
//   Sandy / Flo / Reed / Grandma（eloquence，say 列表里的「X (中文（中国大陆）)」）  每长句 2~4 处、约 300ms
// 退出码：全部干净 = 0，任一段有 hardCut = 1（方便接进流水线）。
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const NL = String.fromCharCode(10)

function resolveFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  for (const candidate of [
    process.env.FFMPEG,
    path.join(__dirname, 'tools', exe),
    path.join(__dirname, 'node_modules', 'ffmpeg-static', exe),
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return exe                                  // 退到 PATH
}

const FFMPEG = resolveFfmpeg()

function pcm(file) {
  const result = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 30 })
  if (result.status !== 0) return null
  return result.stdout
}

function report(file) {
  const buf = pcm(file)
  if (!buf || !buf.length) return { file: path.basename(file), err: '无法解码（ffmpeg 不可用？）' }
  const samples = Math.floor(buf.length / 2)
  const WINDOW = 160                                   // 10 ms @16k
  const zeroRuns = []
  let zeroRun = 0
  for (let i = 0; i < samples; i++) {
    if (buf.readInt16LE(i * 2) === 0) zeroRun++
    else { if (zeroRun >= WINDOW) zeroRuns.push(Math.round(zeroRun / 16)); zeroRun = 0 }
  }
  const rms = []
  for (let i = 0; i + WINDOW <= samples; i += WINDOW) {
    let sum = 0
    for (let j = 0; j < WINDOW; j++) { const v = buf.readInt16LE((i + j) * 2) / 32768; sum += v * v }
    rms.push(Math.sqrt(sum / WINDOW))
  }
  const sorted = rms.slice().sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1e-9
  const cuts = []
  let i = 2
  while (i < rms.length) {
    if (rms[i] <= p95 * 0.01) {
      let j = i
      while (j < rms.length && rms[j] <= p95 * 0.01) j++
      const ms = (j - i) * 10
      const before = Math.max(rms[i - 1], rms[i - 2])
      if (ms >= 80 && ms <= 600 && before >= p95 * 0.25 && j < rms.length && rms[j] >= p95 * 0.25) cuts.push((i * 0.01).toFixed(2) + 's/' + ms + 'ms')
      i = j
    } else i++
  }
  return {
    file: path.basename(file),
    dur: +(samples / 16000).toFixed(2),
    zeroRuns: zeroRuns.length,
    maxZeroMs: zeroRuns.length ? Math.max.apply(null, zeroRuns) : 0,
    hardCuts: cuts.length,
    cuts: cuts.slice(0, 6),
  }
}

const files = process.argv.slice(2)
if (!files.length) {
  process.stderr.write('用法: node qa-tts-audio.cjs <音频文件...>' + NL)
  process.exit(2)
}
let bad = 0
for (const file of files) {
  const item = report(file)
  if (item.err) { process.stdout.write(JSON.stringify(item) + NL); bad++; continue }
  if (item.hardCuts > 0) bad++
  process.stdout.write(JSON.stringify(item) + NL)
}
if (bad) {
  process.stderr.write(NL + '有 ' + bad + ' 个文件存在硬切丢块：换 compact 音色（say: Tingting/Meijia；Windows: 换一个 SAPI 中文人声）重新合成。' + NL)
  process.exit(1)
}
process.stderr.write(NL + '全部干净。' + NL)
