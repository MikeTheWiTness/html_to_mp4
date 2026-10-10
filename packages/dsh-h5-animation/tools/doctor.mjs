/**
 * doctor —— 「阶段零 · 环境自检」的确定性实现。
 *
 * 为什么单独一个文件：CLI 是退路，自检逻辑要能被单测直接 import，
 * 不能把宿主 HTTP 依赖或交互塞进来。这里只做「探测 + 按需安装」，不做创作判断。
 *
 * 用法（CLI）：h5video doctor [--json] [--fix [--yes]] [--playwright-core <版本>]
 *
 * 分级：
 *   blocking    缺了就出不了片（ffmpeg / ffprobe / Chromium+playwright-core / 骨架文件）
 *   degradable  缺了能降级（无中文语音 → 无声片或 --reuse-tts；无 CJK 字体 → 中文变方框）
 *   ok          可用
 *
 * 安装闸门：--fix 不带 --yes 只打印将要执行的命令并退 3；带 --yes 才真的下载/安装。
 * 镜像：H5VIDEO_MIRROR 指向一个扁平目录，按固定文件名取包；npm 相关走 npm_config_registry。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const DOCTOR_SCHEMA = 1
const isWin = process.platform === 'win32'
const exeName = (name) => (isWin ? name + '.exe' : name)

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { ...opts, stdio: opts.stdio || ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, out: '', err: String(error && error.message) })
      return
    }
    let out = ''
    let err = ''
    const cap = 1024 * 1024
    if (child.stdout) child.stdout.on('data', (d) => { if (out.length < cap) out += d })
    if (child.stderr) child.stderr.on('data', (d) => { if (err.length < cap) err += d })
    child.on('error', (error) => resolve({ code: -1, out, err: err + String(error && error.message) }))
    child.on('close', (code) => resolve({ code: code === null ? -1 : code, out, err }))
  })
}

function isExecutableFile(candidate) {
  try { return fs.statSync(candidate).isFile() } catch { return false }
}

function whichSync(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter)
  for (const dir of dirs) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function currentPlatform() {
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'win32') return 'win32'
  return 'linux'
}

/* ------------------------------- 各项检查 ------------------------------- */

async function checkNode() {
  const major = Number(String(process.version).replace(/^v/, '').split('.')[0])
  const ok = major >= 18
  return {
    id: 'node', title: 'Node.js', status: ok ? 'ok' : 'blocking',
    detail: process.version,
    why: ok ? '' : '流程脚本需要 Node 18+（ESM、top-level await、fs.cpSync）',
    fix: ok ? null : { manual: '安装 Node.js 18 LTS 或更高：https://nodejs.org/ ，或用 nvm/fnm 切换版本' },
  }
}

function checkSkillLayout(skillDir, templates) {
  const need = [
    ['SKILL.md', path.join(skillDir, 'SKILL.md')],
    ['references/pipeline.md', path.join(skillDir, 'references', 'pipeline.md')],
    ['templates/animation.html', path.join(templates, 'animation.html')],
    ['templates/build.mjs', path.join(templates, 'build.mjs')],
    ['templates/storyboard.cjs', path.join(templates, 'storyboard.cjs')],
    ['templates/script.json', path.join(templates, 'script.json')],
    ['templates/vendor/katex/katex.min.js', path.join(templates, 'vendor', 'katex', 'katex.min.js')],
    ['tools/install-tools.sh', path.join(skillDir, 'tools', 'install-tools.sh')],
  ]
  const missing = need.filter(([, p]) => !fs.existsSync(p)).map(([label]) => label)
  return {
    id: 'skill-layout', title: '随包 skill 文件', status: missing.length ? 'blocking' : 'ok',
    detail: missing.length ? '缺少 ' + missing.join('、') : '完整',
    why: missing.length ? '随包副本被不完整地复制/安装，scaffold 与公式渲染都会缺件' : '',
    fix: missing.length ? { manual: '重新安装插件包，或直接从仓库复制 ' + skillDir } : null,
  }
}

function binaryCandidates(name, workRoot, skillDir, templates) {
  const exe = exeName(name)
  const list = []
  const push = (candidate, origin) => { if (candidate && !list.some((i) => i.path === candidate)) list.push({ path: candidate, origin }) }
  const envKey = name.toUpperCase()
  if (process.env[envKey]) push(process.env[envKey], 'env ' + envKey)
  if (process.env.H5VIDEO_TOOLS_DIR) push(path.join(process.env.H5VIDEO_TOOLS_DIR, exe), 'H5VIDEO_TOOLS_DIR')
  push(path.join(workRoot, 'tools', exe), '工作区 tools/')
  push(path.join(skillDir, 'tools', exe), 'skill tools/')
  push(path.join(templates, '..', 'tools', exe), '随包 tools/')
  push(path.join(workRoot, 'node_modules', name + '-static', exe), '工作区 ' + name + '-static')
  const plat = currentPlatform()
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
  push(path.join(workRoot, 'node_modules', '@' + name + '-installer', plat + '-' + arch, exe), '工作区 @' + name + '-installer')
  const onPath = whichSync(exe)
  if (onPath) push(onPath, 'PATH')
  return list
}

async function inspectBinary(candidate) {
  const result = await run(candidate.path, ['-version'])
  if (result.code !== 0) return { ...candidate, usable: false, reason: (result.err || result.out || 'exit ' + result.code).split(String.fromCharCode(10))[0].slice(0, 120) }
  return { ...candidate, usable: true, version: (result.out || '').split(String.fromCharCode(10))[0] }
}

async function checkBinary(name, workRoot, skillDir, templates) {
  const attempts = []
  for (const candidate of binaryCandidates(name, workRoot, skillDir, templates)) {
    if (!isExecutableFile(candidate.path)) { attempts.push({ path: candidate.path, origin: candidate.origin, reason: '文件不存在' }); continue }
    const inspected = await inspectBinary(candidate)
    if (inspected.usable) {
      return { id: name, title: name, status: 'ok', detail: inspected.path + '  (' + inspected.origin + ')', version: inspected.version, why: '', fix: null, attempts }
    }
    attempts.push({ path: candidate.path, origin: candidate.origin, reason: inspected.reason })
  }
  const installDir = path.join(workRoot, 'tools')
  return {
    id: name, title: name, status: 'blocking', detail: '不可用', version: null, attempts,
    why: name === 'ffmpeg' ? '逐帧编码与混流都要用 ffmpeg（必须是带 libx264/aac 的静态版，Playwright 自带的阉割版不行）' : '量语音时长、出片校验都要用 ffprobe；架构不符的二进制会「能执行但一跑就挂」',
    fix: isWin
      ? { win32: ['powershell -ExecutionPolicy Bypass -File "' + path.join(skillDir, 'tools', 'install-tools.ps1') + '" -TargetDir "' + installDir + '"'], manual: '或 winget install Gyan.FFmpeg（装完 PATH 上就有 ffmpeg/ffprobe），并把 bin 目录填进 H5VIDEO_TOOLS_DIR' }
      : { darwin: ['bash "' + path.join(skillDir, 'tools', 'install-tools.sh') + '" "' + installDir + '"'], manual: '或 brew install ffmpeg；也可以自己放静态二进制到 ' + installDir + ' 或设 H5VIDEO_TOOLS_DIR' },
    sizeMB: 120, network: true,
  }
}

/* --------------------------- Chromium / playwright-core --------------------------- */
function playwrightCacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') return process.env.PLAYWRIGHT_BROWSERS_PATH
  if (isWin) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  return path.join(os.homedir(), '.cache', 'ms-playwright')
}

function installedChromiumRevisions(cacheDir) {
  let entries = []
  try { entries = fs.readdirSync(cacheDir) } catch { return [] }
  const revs = []
  for (const entry of entries) {
    const match = /^chromium(?:_headless_shell)?-(\d+)$/.exec(entry)
    if (match) revs.push({ dir: entry, revision: Number(match[1]) })
  }
  return revs
}

function coreCandidates(workRoot) {
  const found = []
  const push = (dir, origin) => {
    const pkg = path.join(dir, 'package.json')
    if (!fs.existsSync(pkg)) return
    if (found.some((f) => f.dir === dir)) return
    try {
      const meta = JSON.parse(fs.readFileSync(pkg, 'utf8'))
      const browsers = JSON.parse(fs.readFileSync(path.join(dir, 'browsers.json'), 'utf8'))
      const chromium = browsers.browsers.find((b) => b.name === 'chromium')
      found.push({ dir, origin, version: meta.version, revision: chromium ? Number(chromium.revision) : null })
    } catch { /* 结构不符就跳过 */ }
  }
  if (process.env.PW_CORE) push(process.env.PW_CORE, 'env PW_CORE')
  for (const base of [workRoot, process.cwd()]) {
    for (const candidate of [path.join(base, 'node_modules', 'playwright-core'), path.join(base, 'node_modules', 'playwright', 'node_modules', 'playwright-core')]) push(candidate, path.relative(workRoot, candidate) || candidate)
  }
  // 工作区里的项目可能是一层（<工作区>/<项目>）或两层（<工作区>/projects/<项目>），
  // 两种都要能定位到项目内安装的 playwright-core —— 这正是「浏览器版本对、core 解析不到」的坑。
  const scan = (base, depth) => {
    let entries = []
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { return }
    for (const entry of entries.slice(0, 200)) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const dir = path.join(base, entry.name)
      push(path.join(dir, 'node_modules', 'playwright-core'), path.relative(workRoot, dir) + '/node_modules')
      if (depth > 1) scan(dir, depth - 1)
    }
  }
  scan(workRoot, 2)
  const npxRoot = path.join(os.homedir(), '.npm', '_npx')
  try {
    for (const entry of fs.readdirSync(npxRoot)) push(path.join(npxRoot, entry, 'node_modules', 'playwright-core'), 'npx 缓存')
  } catch { /* 没跑过 npx */ }
  return found
}

export function browserSummary(workRoot) {
  const cacheDir = playwrightCacheDir()
  const browsers = installedChromiumRevisions(cacheDir)
  const cores = coreCandidates(workRoot)
  const match = cores.find((c) => browsers.some((b) => b.revision === c.revision))
  return { cacheDir, browsers, cores, match: match || null }
}

async function checkBrowser(workRoot, playwrightCoreVersion) {
  const summary = browserSummary(workRoot)
  const { cacheDir, browsers, cores, match } = summary
  const detail = '浏览器 ' + (browsers.length ? browsers.map((b) => b.dir).join(', ') : '无') +
    '；playwright-core ' + (cores.length ? cores.map((c) => c.version + '(期望 chromium-' + c.revision + ')').join(', ') : '无')
  if (match) {
    return { id: 'browser', title: 'Chromium + playwright-core', status: 'ok', detail: detail + ' → 匹配 ' + match.version, why: '', fix: null }
  }
  const steps = []
  if (playwrightCoreVersion) {
    steps.push('npm install playwright-core@' + playwrightCoreVersion + ' --prefix "' + workRoot + '" --no-save')
    steps.push('npx -y playwright@' + playwrightCoreVersion + ' install chromium')
  } else {
    const newest = cores.slice().sort((a, b) => String(b.version).localeCompare(String(a.version)))[0]
    if (newest) steps.push('npx -y playwright@' + newest.version + ' install chromium')
    else steps.push('npx -y playwright install chromium')
    steps.push('npm install playwright-core@latest --prefix "' + workRoot + '" --no-save')
  }
  return {
    id: 'browser', title: 'Chromium + playwright-core', status: 'blocking', detail,
    why: 'storyboard / build 要从项目目录解析 playwright-core，且它的 browsers.json 版本必须与本机已装的 chromium-<revision> 一致；不一致时脚本直接报「找不到 playwright-core」',
    fix: { darwin: steps, win32: steps, manual: '也可以指定版本让 doctor 精确匹配：h5video doctor --fix --yes --playwright-core 1.61.0' },
    sizeMB: 160, network: true,
  }
}

/* --------------------------------- 语音合成 --------------------------------- */
const ELOQUENCE_PREFIX = 'com.apple.eloquence.'
const COMPACT_ZH = ['Tingting', 'Meijia', 'Sinji']

/** 把 say 列表 + compact 探测结果分成「干净音色 / 会丢块音色」。 */
export function classifyZhVoices(listed, compactProbes) {
  const eloquence = listed.filter((v) => /\(中文/.test(v.name)).map((v) => v.name)
  const clean = []
  for (const probe of compactProbes) if (probe.usable) clean.push(probe.name)
  return { clean, eloquence, all: listed.map((v) => v.name) }
}

export function describeVoiceRisks(classified) {
  if (!classified.eloquence.length) return null
  return '检测到 eloquence 类中文音色（' + classified.eloquence.slice(0, 3).join('、') + ' 等）：写文件时每约 1.7 s 丢约 300 ms 音频块，成片会卡顿；' +
    (classified.clean.length ? '请改用 compact 音色：' + classified.clean.join('、') : '本机没有 compact 中文音色，先用外部 TTS 预生成 work/segN.aiff 再 build --reuse-tts')
}

function parseSayVoices(text) {
  const voices = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^(\S.*?)\s{2,}([A-Za-z]{2}(?:[_-][A-Za-z0-9]+)*)\s*(?:#\s*(.*))?$/)
    if (match) voices.push({ name: match[1].trim(), locale: match[2], sample: (match[3] || '').trim() })
  }
  return voices
}

async function checkTts(workRoot, templates) {
  if (process.platform === 'linux') {
    return {
      id: 'tts', title: '中文语音合成', status: 'degradable', detail: '本包不覆盖 Linux 本地合成',
      why: 'Linux 无 say/SAPI：只能用外部 TTS 预生成分段音频', fix: null,
      fallback: '外部 TTS 生成 work/segN.aiff（分段文案见 script.json）→ node build.mjs --approved --reuse-tts',
    }
  }
  if (isWin) {
    const ps = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const query = 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture }'
    const result = await run(isExecutableFile(ps) ? ps : 'powershell', ['-NoProfile', '-Command', query])
    const voices = String(result.out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const zh = voices.filter((v) => /zh-CN|zh-TW|Chinese|中文|Huihui|Yaoyao|Kangkang/i.test(v))
    const script = path.join(templates, 'tts-win.ps1')
    if (zh.length) {
      return {
        id: 'tts', title: '中文语音合成（SAPI）', status: 'ok', detail: '可用人声：' + zh.join('、'),
        why: '', fix: null,
        hint: 'Windows 没有 say：先跑 powershell -ExecutionPolicy Bypass -File "' + script + '" 生成 work/segN.aiff，再 node build.mjs --approved --reuse-tts',
      }
    }
    return {
      id: 'tts', title: '中文语音合成（SAPI）', status: 'degradable',
      detail: voices.length ? '已装人声：' + voices.slice(0, 5).join('、') + '（无中文）' : '读不到 SAPI 人声',
      why: '没有中文人声就只能出无声片', fix: { win32: ['start ms-settings:speech'], manual: '设置 → 时间和语言 → 语音 → 管理语音 → 添加「中文(简体，中国)」音色（推荐 Microsoft Huihui）' },
      fallback: '或用外部 TTS 预生成 work/segN.aiff 再 build --reuse-tts',
    }
  }
  // macOS
  const say = isExecutableFile('/usr/bin/say') ? '/usr/bin/say' : whichSync('say')
  if (!say) {
    return { id: 'tts', title: '中文语音合成（say）', status: 'degradable', detail: '找不到 say', why: '没有 say 只能出无声片', fix: { manual: '确认 /usr/bin/say 存在（属于 macOS 基础系统）' }, fallback: '外部 TTS 生成 work/segN.aiff → build --reuse-tts' }
  }
  const listed = parseSayVoices((await run(say, ['-v', '?'])).out).filter((v) => v.locale.toLowerCase().startsWith('zh'))
  const probes = []
  for (const name of COMPACT_ZH) {
    const probeFile = path.join(os.tmpdir(), 'h5video-voice-' + name + '.aiff')
    const result = await run(say, ['-v', name, '-r', '178', '-o', probeFile, '测'])
    probes.push({ name, usable: result.code === 0 && isExecutableFile(probeFile) })
    try { fs.unlinkSync(probeFile) } catch { /* 忽略 */ }
  }
  const classified = classifyZhVoices(listed, probes)
  const risky = describeVoiceRisks(classified)
  if (!classified.clean.length && !classified.all.length) {
    return { id: 'tts', title: '中文语音合成（say）', status: 'degradable', detail: '没有可用的中文音色', why: '没有中文音色只能出无声片', fix: { manual: '系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音，下载中文（中国大陆）音色' }, fallback: '外部 TTS 生成 work/segN.aiff → build --reuse-tts' }
  }
  return {
    id: 'tts', title: '中文语音合成（say）', status: classified.clean.length ? 'ok' : 'degradable',
    detail: 'compact 可用：' + (classified.clean.join('、') || '无（仅 ' + classified.all.length + ' 个 eloquence 音色）'),
    why: risky || '', fix: null,
    warning: risky, fallback: classified.clean.length ? '' : '外部 TTS 生成 work/segN.aiff → build --reuse-tts',
    pick: classified.clean[0] || null,
  }
}

/* ---------------------------------- 字体 ---------------------------------- */
function checkFont() {
  if (process.platform === 'darwin') {
    const ok = fs.existsSync('/System/Library/Fonts/PingFang.ttc') || fs.existsSync('/System/Library/Fonts/STHeiti Light.ttc')
    return { id: 'cjk-font', title: '中文字体', status: ok ? 'ok' : 'degradable', detail: ok ? 'PingFang SC / STHeiti' : '未找到系统中文字体', why: ok ? '' : '画面里的中文会渲染成方框（canvas 绘制不报错，静默出错）', fix: ok ? null : { manual: 'macOS 自带中文；如被裁剪请重装系统字体或用 "brew install --cask font-noto-sans-cjk-sc"' } }
  }
  if (isWin) {
    const root = process.env.SystemRoot || 'C:/Windows'
    const ok = ['msyh.ttc', 'msyh.ttf', 'simhei.ttf'].some((f) => fs.existsSync(path.join(root, 'Fonts', f)))
    return { id: 'cjk-font', title: '中文字体', status: ok ? 'ok' : 'degradable', detail: ok ? '微软雅黑 / 黑体' : '未找到系统中文字体', why: ok ? '' : '画面里的中文会渲染成方框', fix: ok ? null : { manual: '设置 → 时间和语言 → 语言 → 中文(简体) 的「可选语言功能」里勾选补充字体' } }
  }
  return { id: 'cjk-font', title: '中文字体', status: 'degradable', detail: '未检查（本包不覆盖 Linux）', why: 'Linux 上需自行确保有 Noto Sans CJK 等中文字体', fix: null }
}

/* -------------------------------- 工作区/磁盘 -------------------------------- */
function checkWorkspace(workRoot) {
  try {
    fs.mkdirSync(workRoot, { recursive: true })
    const probe = path.join(workRoot, '.h5video-write-test')
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return { id: 'workspace', title: '工作区可写', status: 'ok', detail: workRoot, why: '', fix: null }
  } catch (error) {
    return { id: 'workspace', title: '工作区可写', status: 'blocking', detail: String(error && error.message).slice(0, 120), why: '项目、分镜、逐帧截图都要写进工作区', fix: { manual: '换一个可写目录，或给 ' + workRoot + ' 加写权限' } }
  }
}

async function checkDisk(workRoot) {
  if (isWin) return { id: 'disk', title: '磁盘可用空间', status: 'ok', detail: '未检查（Windows）', why: '', fix: null }
  const result = await run('df', ['-kP', workRoot])
  const line = String(result.out || '').trim().split(String.fromCharCode(10)).pop() || ''
  const parts = line.split(/\s+/)
  const availKb = Number(parts[3])
  if (!Number.isFinite(availKb)) return { id: 'disk', title: '磁盘可用空间', status: 'ok', detail: '未检查', why: '', fix: null }
  const freeMB = Math.round(availKb / 1024)
  const ok = freeMB >= 800
  return {
    id: 'disk', title: '磁盘可用空间', status: ok ? 'ok' : 'degradable', detail: freeMB + ' MB',
    why: ok ? '' : '逐帧 JPEG 与中间件峰值可达数百 MB，空间不足会在录制中途失败',
    fix: ok ? null : { manual: '清理空间，或把项目放到空间更大的盘；也可以用 build --keep-frames 之外的方式减少占用' },
  }
}

function checkMirror() {
  const mirror = process.env.H5VIDEO_MIRROR || ''
  const registry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || ''
  return {
    id: 'mirror', title: '下载源', status: 'ok',
    detail: (mirror ? 'H5VIDEO_MIRROR=' + mirror : 'H5VIDEO_MIRROR 未设置（用上游源）') + (registry ? '；npm registry=' + registry : ''),
    why: '', fix: null,
  }
}

/* --------------------------------- 主流程 --------------------------------- */
export async function collectChecks({ workRoot, skillDir, templates, playwrightCoreVersion }) {
  const checks = []
  checks.push(await checkNode())
  checks.push(checkSkillLayout(skillDir, templates))
  checks.push(checkWorkspace(workRoot))
  checks.push(await checkDisk(workRoot))
  checks.push(await checkBinary('ffmpeg', workRoot, skillDir, templates))
  checks.push(await checkBinary('ffprobe', workRoot, skillDir, templates))
  checks.push(await checkBrowser(workRoot, playwrightCoreVersion))
  checks.push(await checkTts(workRoot, templates))
  checks.push(checkFont())
  checks.push(checkMirror())
  return checks
}

function fixStepsFor(check) {
  const fix = check.fix
  if (!fix) return []
  const plat = currentPlatform()
  if (Array.isArray(fix[plat])) return fix[plat]
  if (Array.isArray(fix.manual)) return fix.manual
  if (typeof fix.manual === 'string') return [fix.manual]
  return []
}

export function describeFix(check) {
  const steps = fixStepsFor(check)
  if (steps.length) return steps
  if (check.fix && check.fix.manual) return [check.fix.manual]
  return []
}

export function toReport(checks, extra = {}) {
  const blocking = checks.filter((c) => c.status === 'blocking')
  const degradable = checks.filter((c) => c.status === 'degradable')
  return {
    schema: DOCTOR_SCHEMA,
    ready: blocking.length === 0,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    mirror: process.env.H5VIDEO_MIRROR || null,
    blocking: blocking.map((c) => ({ id: c.id, title: c.title, detail: c.detail, why: c.why, fix: describeFix(c), sizeMB: c.sizeMB || null, network: Boolean(c.network) })),
    degradable: degradable.map((c) => ({ id: c.id, title: c.title, detail: c.detail, why: c.why, fallback: c.fallback || '', fix: describeFix(c) })),
    checks,
    ...extra,
  }
}

function render(report, log) {
  const mark = (s) => (s === 'ok' ? '✓' : s === 'blocking' ? '✗' : '⚠')
  log('h5video 环境自检（阶段零）')
  log('  平台      ' + report.platform + ' ' + report.arch + ' / node ' + report.node)
  log('  就绪      ' + (report.ready ? '是' : '否：有 ' + report.blocking.length + ' 项必须先解决'))
  log('')
  for (const check of report.checks) {
    const label = check.title.length >= 26 ? check.title + '  ' : check.title.padEnd(26)
    log('  ' + mark(check.status) + ' ' + label + String(check.detail || '').slice(0, 160))
    if (check.why && check.status !== 'ok') log('      ↳ ' + check.why)
    if (check.hint) log('      ↳ ' + check.hint)
    if (check.fallback && check.status !== 'ok') log('      ↳ 降级：' + check.fallback)
  }
  if (report.blocking.length) {
    log('')
    log('必须先解决：')
    for (const item of report.blocking) {
      log('  ' + item.title + '：' + item.why)
      for (const step of item.fix) log('      ' + step)
    }
    log('')
    log('解决方式（二选一）：h5video doctor --fix --yes  或 按上面的命令手工执行，然后重跑 h5video doctor')
  }
  if (report.degradable.length) {
    log('')
    log('可降级项：')
    for (const item of report.degradable) log('  ' + item.title + '：' + (item.fallback || item.why))
  }
}

export async function runDoctor(options) {
  const {
    json = false, fix = false, yes = false, playwrightCoreVersion = '',
    workRoot, skillDir, templates,
    log = (s) => process.stdout.write(String(s) + String.fromCharCode(10)),
    logErr = (s) => process.stderr.write(String(s) + String.fromCharCode(10)),
  } = options

  const first = toReport(await collectChecks({ workRoot, skillDir, templates, playwrightCoreVersion }))

  if (fix && first.blocking.length) {
    const steps = []
    for (const item of first.blocking) {
      const target = first.checks.find((c) => c.id === item.id)
      for (const step of target ? fixStepsFor(target) : []) {
        if (!step.startsWith('或 ')) steps.push({ id: item.id, step })
      }
    }
    if (!yes) {
      log('即将执行以下安装命令（需要你确认后加 --yes 重跑）：')
      for (const item of steps) log('  [' + item.id + '] ' + item.step)
      log('')
      log('这些命令会联网下载（总体积约 ' + first.blocking.reduce((sum, i) => sum + (i.sizeMB || 0), 0) + ' MB）。')
      log('内网请先设置 H5VIDEO_MIRROR（扁平镜像目录）与 npm_config_registry。')
      return 3
    }
    for (const item of steps) {
      log('执行 [' + item.id + '] ' + item.step)
      const result = await run(item.step, [], { shell: true, stdio: 'inherit' })
      if (result.code !== 0) logErr('  命令失败（exit ' + result.code + '）：' + item.step)
    }
    const second = toReport(await collectChecks({ workRoot, skillDir, templates, playwrightCoreVersion }))
    if (json) log(JSON.stringify(second, null, 2))
    else { render(second, log); log(''); log(second.ready ? '自检通过。' : '仍有未解决项，按上面的提示处理后重跑。') }
    return second.ready ? 0 : 1
  }

  if (json) log(JSON.stringify(first, null, 2))
  else {
    render(first, log)
    if (!first.blocking.length) { log(''); log('自检通过' + (first.degradable.length ? '（有可降级项，见上）' : '') + '。') }
  }
  return first.ready ? 0 : 1
}
