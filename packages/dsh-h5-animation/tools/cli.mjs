#!/usr/bin/env node
/**
 * h5video — h5-animation-video 流程的确定性操作面。
 *
 * 这里只做「找工具 + 起进程 + 收输出」，不含任何创作判断：
 * 文案、构图、节奏仍然由宿主 agent 决定，脚本与 ffmpeg 只负责量时长、截图、编码、探测。
 * CLI 永远是退路——插件坏了，bash 里 `node storyboard.cjs` / `node build.mjs` 照样能跑。
 *
 * 子命令：
 *   check-env [--json]                环境体检（ffmpeg / ffprobe / say / Chromium / skill 布局）
 *   doctor [--json] [--fix [--yes]]   阶段零自检：分级列出缺件与修复命令，--fix --yes 才真的安装
 *                                     --playwright-core <版本> 指定要装的 playwright-core 版本
 *   scaffold <目录>                    从随包 templates 生成项目骨架（不覆盖已有文件）
 *   plan <项目>                        只打印预估时间轴（不开浏览器）
 *   storyboard <项目> [参数...]        阶段一：出分镜图，交人审核
 *   qa <项目> [--static] [--strict]   公式与画面体检，产出 work/qa/report.json（出片闸门）
 *   build <项目> --approved [参数...]  阶段二：TTS → 逐帧录制 → 编码 → 混流
 *   probe <媒体文件>                   ffprobe 结构化探测（JSON）
 *   voices [--query 文本] [--all]      say 音色列表（默认只看中文）
 *
 * 只用 Node 内建模块：随 DSH 安装的 @deepseek-ai/* 包在 profile 里不一定解析得到。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runDoctor, browserSummary } from './doctor.mjs'

const NL = String.fromCharCode(10)
const HERE = path.dirname(fileURLToPath(import.meta.url))          // <包>/tools
const PKG = path.dirname(HERE)                                      // <包>
const SKILL_DIR = path.join(PKG, 'skills', 'h5-animation-video')
const TEMPLATES = path.join(SKILL_DIR, 'templates')
const WORK_ROOT = process.env.H5VIDEO_WORK_ROOT || process.cwd()
const TOOLS_DIR = process.env.H5VIDEO_TOOLS_DIR || ''
const MAX_OUT = Number(process.env.H5VIDEO_MAX_OUTPUT_BYTES) > 0 ? Number(process.env.H5VIDEO_MAX_OUTPUT_BYTES) : 1048576

const isWin = process.platform === 'win32'
const exeName = (name) => (isWin ? name + '.exe' : name)

function write(text) { process.stdout.write(text + NL) }
function writeErr(text) { process.stderr.write(text + NL) }

/** 在 PATH 里找可执行文件（不依赖外部 which）。 */
function whichSync(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // 继续找下一个 PATH 目录
    }
  }
  return null
}

function isExecutableFile(candidate) {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * ffmpeg / ffprobe 的候选位置，按固定优先级：
 * 显式 env → 插件配置的 toolsDir → 随包 tools/ → skill tools/ → 会话工作区 tools/
 * → 工作区 npm 静态包 → PATH。
 * 只是「候选」：真正可用与否由 version() 实际执行一次来判断——架构不符的二进制
 * （例如 x86_64 的 ffprobe 在没有 Rosetta 的 arm64 机器上）必须被跳过，而不是选中后报错。
 */
function candidateList(name) {
  const exe = exeName(name)
  const list = []
  const push = (candidate, origin) => {
    if (candidate && !list.some((item) => item.path === candidate)) list.push({ path: candidate, origin })
  }
  const envKey = name.toUpperCase()
  if (process.env[envKey]) push(process.env[envKey], 'env ' + envKey)
  if (TOOLS_DIR) push(path.join(TOOLS_DIR, exe), 'H5VIDEO_TOOLS_DIR')
  push(path.join(PKG, 'tools', exe), '随包 tools/')
  push(path.join(SKILL_DIR, 'tools', exe), 'skill tools/')
  push(path.join(WORK_ROOT, 'tools', exe), '工作区 tools/')
  push(path.join(WORK_ROOT, 'node_modules', name + '-static', exe), '工作区 ' + name + '-static')
  const plat = { darwin: 'darwin', linux: 'linux', win32: 'win32' }[process.platform] || process.platform
  const archDir = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
  if (name === 'ffprobe') {
    push(path.join(WORK_ROOT, 'node_modules', 'ffprobe-static', 'bin', plat, archDir, exe), '工作区 ffprobe-static')
  }
  // @ffprobe-installer / @ffmpeg-installer 的平台包：macOS arm64 上这才是真 arm64 二进制
  // （ffprobe-static 在 macOS 上仍然只发 x86_64，装了也跑不起来）。
  push(path.join(WORK_ROOT, 'node_modules', '@' + name + '-installer', plat + '-' + archDir, exe), '工作区 @' + name + '-installer')
  const onPath = whichSync(exe)
  if (onPath) push(onPath, 'PATH')
  return list
}

const versionCache = new Map()
/** 实际执行一次 `-version`，判断这个候选能不能用。 */
async function inspectBinary(name, candidate) {
  const key = name + '|' + candidate.path
  if (versionCache.has(key)) return versionCache.get(key)
  let info
  if (!isExecutableFile(candidate.path)) {
    info = { usable: false, version: '', detail: '文件不存在或不是普通文件' }
  } else {
    const result = await run(candidate.path, ['-version'])
    const text = (result.out || '') + (result.err || '')
    const broken = /Bad CPU type|cannot execute|Exec format error|Permission denied|No such file/i.test(text)
    const version = firstLine(result.out)
    info = {
      usable: result.code === 0 && version.length > 0 && !broken,
      version,
      detail: broken || result.code !== 0 ? firstLine(result.err) || firstLine(result.out) : '',
    }
  }
  versionCache.set(key, info)
  return info
}

/** 按候选顺序挑第一个真正可用的二进制；返回 { path, origin, version, attempts }。 */
async function pickBinary(name) {
  const attempts = []
  for (const candidate of candidateList(name)) {
    const info = await inspectBinary(name, candidate)
    attempts.push({ ...candidate, usable: info.usable, version: info.version, detail: info.detail })
    if (info.usable) return { path: candidate.path, origin: candidate.origin, version: info.version, attempts }
  }
  return { path: null, origin: null, version: null, attempts }
}

/** 按平台给出「去哪儿拿一个能跑的二进制」的具体建议。 */
function installAdvice(name) {
  if (process.platform === 'win32') {
    return '请在项目目录执行 tools\\install-tools.ps1（gyan.dev 的 Windows 静态版），或 winget install Gyan.FFmpeg。'
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    if (name === 'ffprobe') {
      return '请在项目目录执行 tools/install-tools.sh（会取 @ffprobe-installer/darwin-arm64），或 brew install ffmpeg。注意 ffprobe-static 在 macOS 上只有 x86_64，装了也跑不起来。'
    }
    return '请在项目目录执行 tools/install-tools.sh，或 brew install ffmpeg。'
  }
  return '请在项目目录执行 tools/install-tools.sh，或 npm i ' + name + '-static。'
}

/** 把失败的候选写成一句可执行的话。 */
function describeAttempts(name, attempts) {
  const advice = installAdvice(name)
  const present = attempts.filter((item) => item.detail !== '文件不存在或不是普通文件')
  if (!attempts.length || !present.length) {
    return '找不到 ' + name + '（检查过 ' + attempts.length + ' 个位置）：' + advice
  }
  const parts = present.map((item) => item.path + '（' + (item.detail || '不可用') + '）')
  return name + ' 的候选都不可用：' + parts.join('；') + '。' + advice
}

/** 起一个子进程并收集两路输出；返回 { code, out, err, truncated }（不抛异常）。 */
const liveChildren = new Set()
function killChildren() {
  for (const child of liveChildren) {
    try { child.kill('SIGTERM') } catch { /* 已经退出 */ }
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { killChildren(); process.exit(130) })
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: -1, out: '', err: String(error?.message ?? error), truncated: false })
      return
    }
    liveChildren.add(child)
    let out = '', err = '', truncated = false
    const collect = (chunk, which) => {
      if (which === 'out') { out += chunk; if (out.length > MAX_OUT) { out = out.slice(-MAX_OUT); truncated = true } }
      else { err += chunk; if (err.length > MAX_OUT) { err = err.slice(-MAX_OUT); truncated = true } }
    }
    child.stdout.on('data', (d) => collect(String(d), 'out'))
    child.stderr.on('data', (d) => collect(String(d), 'err'))
    child.on('error', (error) => {
      liveChildren.delete(child)
      resolve({ code: -1, out, err: (err ? err + NL : '') + String(error?.message ?? error), truncated })
    })
    child.on('close', (code) => {
      liveChildren.delete(child)
      resolve({ code: typeof code === 'number' ? code : -1, out, err, truncated })
    })
  })
}

/** 把相对路径按会话工作区解析，避免依赖宿主进程 cwd。 */
function underWorkRoot(target) {
  return path.isAbsolute(target) ? target : path.resolve(WORK_ROOT, target)
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).find((line) => line.trim().length > 0) || ''
}

function playwrightInfo() {
  let cacheDir
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH
  } else if (isWin) {
    cacheDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')
  } else if (process.platform === 'darwin') {
    cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  } else {
    cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright')
  }
  let browsers = []
  try {
    browsers = fs.readdirSync(cacheDir).filter((d) => d.startsWith('chromium'))
  } catch {
    // 没装过 Playwright 浏览器
  }
  return { cacheDir, browsers }
}

function parseSayVoices(text) {
  const voices = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^(\S.*?)\s{2,}([A-Za-z]{2}(?:[_-][A-Za-z0-9]+)*)\s*(?:#\s*(.*))?$/)
    if (match) voices.push({ name: match[1].trim(), locale: match[2], sample: (match[3] || '').trim() })
  }
  return voices
}

function sayPath() {
  if (isWin) return null
  if (isExecutableFile('/usr/bin/say')) return '/usr/bin/say'
  return whichSync('say')
}

async function cmdCheckEnv(argv) {
  const json = argv.includes('--json')
  const ffmpeg = await pickBinary('ffmpeg')
  const ffprobe = await pickBinary('ffprobe')
  const say = sayPath()
  let zhVoices = []
  if (say) zhVoices = parseSayVoices((await run(say, ['-v', '?'])).out).filter((v) => v.locale.toLowerCase().startsWith('zh'))
  const playwright = playwrightInfo()
  const layout = {
    dir: SKILL_DIR,
    skillMd: fs.existsSync(path.join(SKILL_DIR, 'SKILL.md')),
    references: fs.existsSync(path.join(SKILL_DIR, 'references', 'pipeline.md')),
    templates: fs.existsSync(path.join(TEMPLATES, 'storyboard.cjs')),
    example: fs.existsSync(path.join(SKILL_DIR, 'examples', '物理动态演示', 'script.json')),
    binariesBundled: isExecutableFile(path.join(SKILL_DIR, 'tools', exeName('ffmpeg'))),
  }
  const warnings = []
  if (!ffmpeg.path) warnings.push(describeAttempts('ffmpeg', ffmpeg.attempts))
  if (!ffprobe.path) warnings.push(describeAttempts('ffprobe', ffprobe.attempts))
  if (!isWin && !say) warnings.push('找不到 say：旁白只能用现成音频替代。')
  if (isWin) warnings.push('Windows 没有 say：先用系统语音预生成 work/segN.aiff，再 `build --approved --reuse-tts`；见 references/pipeline.md 的「平台支持」。')
  if (!playwright.browsers.length) warnings.push('Playwright 浏览器缓存里没有 chromium-*：先 npx playwright install chromium。')
  if (!layout.templates) warnings.push('随包 templates 缺失：本包可能被不完整地复制。')
  if (ffmpeg.path && !ffprobe.path) warnings.push('ffmpeg 可用但 ffprobe 不可用：时长测量与出片校验都会失败，务必先修好 ffprobe。')

  // 本次实测踩到的两个坑：浏览器/core 版本不匹配、eloquence 音色写文件丢块
  const browser = browserSummary(WORK_ROOT)
  if (playwright.browsers.length && !browser.match) {
    warnings.push('Chromium 与 playwright-core 版本不匹配（浏览器 ' + playwright.browsers.join('、') +
      '，可用 core ' + (browser.cores.length ? browser.cores.map((c) => c.version + '→' + c.revision).join('、') : '无') +
      '）：storyboard / build 会报「找不到 playwright-core」。跑 h5video doctor 看修复命令。')
  }
  const eloquenceVoices = zhVoices.filter((v) => /\(中文/.test(v.name))   // say 里的 "X (中文（中国大陆）)" 都是 eloquence 类
  if (eloquenceVoices.length) {
    warnings.push('中文音色里有 ' + eloquenceVoices.length + ' 个 eloquence 类（' + eloquenceVoices.slice(0, 3).map((v) => v.name).join('、') +
      '）：写文件时每约 1.7 s 丢约 300 ms 音频块，成片语音会卡顿。改用 compact 音色（Tingting / Meijia），或先跑 h5video doctor 看本机可用的干净音色。')
  }

  const report = {
    ok: Boolean(ffmpeg.path && ffprobe.path && layout.templates && (isWin || say) && playwright.browsers.length > 0),
    work_root: WORK_ROOT,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cli: fileURLToPath(import.meta.url),
    ffmpeg: { path: ffmpeg.path, origin: ffmpeg.origin, version: ffmpeg.version },
    ffprobe: { path: ffprobe.path, origin: ffprobe.origin, version: ffprobe.version },
    say: say ? { path: say, zhVoices: zhVoices.map((v) => v.name) } : null,
    playwright,
    skill: layout,
    warnings,
  }

  if (json) {
    // 体检本身算成功（能给出报告），环境是否齐备看 ok / warnings 字段。
    write(JSON.stringify(report, null, 2))
    return 0
  }
  write('h5video 环境体检')
  write('  工作区      ' + WORK_ROOT)
  write('  平台        ' + report.platform + ' ' + report.arch + ' / node ' + report.node)
  write('  ffmpeg      ' + (ffmpeg.path ? ffmpeg.path + '  (' + ffmpeg.origin + ')' : '不可用'))
  write('  ffprobe     ' + (ffprobe.path ? ffprobe.path + '  (' + ffprobe.origin + ')' : '不可用'))
  write('  say         ' + (say ? say + '，中文音色 ' + zhVoices.length + ' 个' + (zhVoices.length ? '：' + zhVoices.slice(0, 8).map((v) => v.name).join(' / ') + (zhVoices.length > 8 ? ' …' : '') : '') : '缺失'))
  write('  chromium    ' + (playwright.browsers.length ? playwright.browsers.join(' / ') + '  (' + playwright.cacheDir + ')' : '缺失'))
  write('  随包 skill  ' + (layout.skillMd && layout.templates ? '完整' : '不完整') + '  ' + layout.dir)
  write('  随包二进制  ' + (layout.binariesBundled ? '有' : '无（按需用 tools/install-tools.sh 或 npm 获取）'))
  if (warnings.length) {
    write('')
    write('待处理：')
    for (const warning of warnings) write('  - ' + warning)
  } else {
    write('')
    write('环境齐备，可以直接进阶段一（h5video storyboard <项目>）。')
  }
  return 0
}

function copyIfAbsent(from, to, log) {
  if (!fs.existsSync(from)) return false
  if (fs.existsSync(to)) { log.skipped.push(path.basename(to)); return false }
  fs.copyFileSync(from, to)
  log.created.push(path.basename(to))
  return true
}

async function cmdScaffold(argv) {
  const target = argv[0]
  if (!target) { writeErr('用法: h5video scaffold <目录>'); return 1 }
  if (!fs.existsSync(TEMPLATES)) { writeErr('随包 templates 缺失：' + TEMPLATES); return 1 }
  const dst = underWorkRoot(target)
  const log = { created: [], skipped: [], linked: [], warned: [] }
  for (const dir of ['', 'out', 'work', 'tools']) fs.mkdirSync(path.join(dst, dir), { recursive: true })
  for (const name of ['animation.html', 'build.mjs', 'storyboard.cjs', 'script.json', 'qa-tts-audio.cjs', 'qa-katex.cjs', 'qa-frames.cjs', 'qa.cjs', 'tts-win.ps1']) {
    copyIfAbsent(path.join(TEMPLATES, name), path.join(dst, name), log)
  }
  const vendorFrom = path.join(TEMPLATES, 'vendor')
  const vendorTo = path.join(dst, 'vendor')
  if (fs.existsSync(vendorFrom) && !fs.existsSync(vendorTo)) {
    fs.cpSync(vendorFrom, vendorTo, { recursive: true })
    log.created.push('vendor/')
  } else if (fs.existsSync(vendorTo)) {
    log.skipped.push('vendor/')
  }
  for (const name of ['ffmpeg', 'ffprobe']) {
    const exe = exeName(name)
    const to = path.join(dst, 'tools', exe)
    if (fs.existsSync(to)) { log.skipped.push(path.join('tools', exe)); continue }
    const found = await pickBinary(name)
    if (!found.path) {
      log.warned.push(describeAttempts(name, found.attempts))
      continue
    }
    try {
      fs.symlinkSync(found.path, to)
      log.linked.push(path.join('tools', exe) + ' -> ' + found.path)
    } catch {
      try {
        fs.copyFileSync(found.path, to)
        fs.chmodSync(to, 0o755)
        log.created.push(path.join('tools', exe))
      } catch (error) {
        log.warned.push('无法放置 ' + name + '：' + String(error?.message ?? error))
      }
    }
  }
  write('已生成项目骨架: ' + dst)
  if (log.created.length) write('  新建   ' + log.created.join(' / '))
  if (log.linked.length) write('  链接   ' + log.linked.join(' / '))
  if (log.skipped.length) write('  跳过   ' + log.skipped.join(' / ') + '（已存在，不覆盖）')
  for (const warning of log.warned) write('  警告   ' + warning)
  write('')
  write('两阶段流程：')
  write('  1) 改 ' + path.join(dst, 'script.json') + ' 写旁白，改 animation.html 写画面')
  write('  2) h5video qa ' + dst + '                # 公式与画面体检（出片闸门）')
  write('  3) h5video storyboard ' + dst + '        # 出分镜，交人审核')
  write('  4) h5video build ' + dst + ' --approved  # 审核通过后出片')
  return 0
}

async function runPipeline(scriptName, argv, options = {}) {
  const usage = scriptName === 'build.mjs'
    ? '用法: h5video build <项目> --approved [--reuse-tts] [--keep-frames] [--skip-qa]'
    : scriptName === 'qa.cjs'
      ? '用法: h5video qa <项目> [--static] [--strict] [--json]'
      : '用法: h5video storyboard <项目> [--shots N] [--at t...]'
  const target = argv[0]
  if (!target || target.startsWith('--')) { writeErr(usage); return 1 }
  const project = underWorkRoot(target)
  if (!fs.existsSync(path.join(project, 'script.json'))) {
    writeErr('缺少 ' + path.join(project, 'script.json') + '：先用 h5video scaffold 生成项目骨架，或把目标指向真正的项目目录。')
    return 1
  }
  const local = path.join(project, scriptName)
  const script = fs.existsSync(local) ? local : path.join(TEMPLATES, scriptName)
  if (!fs.existsSync(script)) { writeErr('找不到 ' + scriptName + '：' + script); return 1 }
  const env = { ...process.env }
  // 只有出片才需要 ffmpeg / ffprobe：分镜阶段（含 --plan）不开这两个进程。
  if (options.resolveTools !== false) {
    // 脚本按 env 优先解析：把体检找到的静态二进制直接交给它们，避免落到 Playwright 自带的阉割版 ffmpeg。
    const ffmpeg = await pickBinary('ffmpeg')
    const ffprobe = await pickBinary('ffprobe')
    if (ffmpeg.path) env.FFMPEG = ffmpeg.path
    if (ffprobe.path) env.FFPROBE = ffprobe.path
    if (!ffmpeg.path) writeErr('h5video 警告：' + describeAttempts('ffmpeg', ffmpeg.attempts))
    if (!ffprobe.path) writeErr('h5video 警告：' + describeAttempts('ffprobe', ffprobe.attempts))
  }
  const result = await run(process.execPath, [script, ...argv.slice(1)], { cwd: project, env })
  if (result.out) process.stdout.write(result.out)
  if (result.err) process.stderr.write(result.err)
  if (result.code === -1 && !result.out && !result.err) writeErr('子进程没有启动：' + process.execPath)
  return result.code
}

async function cmdProbe(argv) {
  const target = argv[0]
  if (!target) { writeErr('用法: h5video probe <媒体文件>'); return 1 }
  const media = underWorkRoot(target)
  if (!fs.existsSync(media)) { writeErr('文件不存在: ' + media); return 1 }
  const ffprobe = await pickBinary('ffprobe')
  if (!ffprobe.path) { writeErr(describeAttempts('ffprobe', ffprobe.attempts)); return 1 }
  const result = await run(ffprobe.path, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', media])
  if (result.out) process.stdout.write(result.out)
  if (result.err) process.stderr.write(result.err)
  return result.code
}

async function cmdVoices(argv) {
  const all = argv.includes('--all')
  const queryIdx = argv.indexOf('--query')
  const query = queryIdx >= 0 ? String(argv[queryIdx + 1] || '').toLowerCase() : ''
  const say = sayPath()
  if (!say) { writeErr(isWin ? 'Windows 没有 say：请改用已有音频或外部 TTS。' : '找不到 say。'); return 1 }
  const listed = await run(say, ['-v', '?'])
  let voices = parseSayVoices(listed.out)
  if (!all) voices = voices.filter((v) => v.locale.toLowerCase().startsWith('zh'))
  if (query) voices = voices.filter((v) => (v.name + ' ' + v.locale + ' ' + v.sample).toLowerCase().includes(query))
  write('say 音色' + (all ? '（全部）' : '（中文）') + '，共 ' + voices.length + ' 个：')
  for (const voice of voices) {
    // eloquence 类（say 列表里带「(中文（中国大陆）)」的那些）写文件会每隔约 1.7 s 丢约 300 ms，绝对不能用来出片
    const risky = /\(中文/.test(voice.name)
    write('  ' + voice.name.padEnd(28) + voice.locale.padEnd(10) + (risky ? '⚠ 会丢块，勿用于出片   ' : '                      ') + voice.sample)
  }
  // compact 音色（Tingting 等）不出现在 say -v '?' 里，但 say -v <名字> 可用，必须单独探一次
  const probes = []
  for (const name of ['Tingting', 'Meijia', 'Sinji']) {
    const probeFile = path.join(os.tmpdir(), 'h5video-voice-probe-' + name + '.aiff')
    const result = await run(say, ['-v', name, '-r', '178', '-o', probeFile, '测'])
    const usable = result.code === 0 && isExecutableFile(probeFile)
    try { fs.unlinkSync(probeFile) } catch { /* 忽略 */ }
    if (usable) probes.push(name)
  }
  if (probes.length && !query) {
    write('')
    write('compact 中文音色（推荐出片用，say -v \'?\' 不列出它们）：')
    for (const name of probes) write('  ' + name.padEnd(28) + '✓ 写文件无丢块')
    write('  用法：把名字填进 script.json 的 voice（例如 "voice": "' + probes[0] + '"）')
  }
  write('')
  write('把选中的名字填进 script.json 的 voice 字段（注意脚本按名字精确匹配）。')
  return 0
}

function help() {
  write('h5video — H5 动画 → 带旁白 MP4 的确定性操作面')
  write('')
  write('用法: h5video <子命令> [参数...]')
  write('')
  write('  check-env [--json]                环境体检（ffmpeg / ffprobe / say / Chromium / skill 布局）')
  write('  doctor [--json] [--fix [--yes]]   阶段零自检：分级缺件 + 修复命令；--fix --yes 才真的安装')
  write('                                    --playwright-core <版本> 指定要装的 playwright-core 版本')
  write('  scaffold <目录>                    从随包 templates 生成项目骨架（不覆盖已有文件）')
  write('  plan <项目>                        只打印预估时间轴（不开浏览器）')
  write('  storyboard <项目> [--shots N] [--at t...]   阶段一：出分镜图，交人审核')
  write('  qa <项目> [--static] [--strict]    阶段二/三：公式与画面体检，产出 work/qa/report.json')
  write('  build <项目> --approved [--reuse-tts] [--skip-qa]   阶段二：TTS → 逐帧录制 → 编码 → 混流')
  write('  probe <媒体文件>                   ffprobe 结构化探测（JSON）')
  write('  voices [--query 文本] [--all]      say 音色列表（默认只看中文）')
  write('')
  write('创作判断不在这里：本工具只起进程、收输出，不会调用任何模型。')
  return 0
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const rest = argv.slice(1)
  switch (command) {
    case 'check-env': return cmdCheckEnv(rest)
    case 'doctor': {
      const idx = rest.indexOf('--playwright-core')
      return runDoctor({
        json: rest.includes('--json'),
        fix: rest.includes('--fix'),
        yes: rest.includes('--yes'),
        playwrightCoreVersion: idx >= 0 ? String(rest[idx + 1] || '') : '',
        workRoot: WORK_ROOT,
        skillDir: SKILL_DIR,
        templates: TEMPLATES,
      })
    }
    case 'scaffold': return cmdScaffold(rest)
    case 'plan': return runPipeline('storyboard.cjs', rest.length ? [rest[0], '--plan', ...rest.slice(1)] : rest, { resolveTools: false })
    case 'storyboard': return runPipeline('storyboard.cjs', rest, { resolveTools: false })
    case 'qa': return runPipeline('qa.cjs', rest, { resolveTools: false })
    case 'build': return runPipeline('build.mjs', rest)
    case 'probe': return cmdProbe(rest)
    case 'voices': return cmdVoices(rest)
    case undefined:
    case 'help':
    case '--help':
    case '-h': return help()
    default:
      writeErr('未知子命令: ' + command)
      writeErr('')
      help()
      return 1
  }
}

process.exitCode = await main()
