/**
 * h5video CLI 的行为测试：不依赖任何外部服务，只验证确定性契约
 * （退出码、JSON 形状、骨架生成、审核闸门透传）。
 *
 * 不覆盖出片质量：真实录制/编码需要 Playwright 与 ffmpeg，属宿主验收范围。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(PKG, 'tools', 'cli.mjs')

/** 会话工作区：优先系统临时目录，沙箱不允许时退回包内 .tmp（测试结束即删）。 */
function makeWorkRoot() {
  try {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'h5video-test-'))
  } catch {
    const fallback = path.join(PKG, '.tmp-test')
    fs.mkdirSync(fallback, { recursive: true })
    return fs.mkdtempSync(path.join(fallback, 'run-'))
  }
}

function h5video(args, workRoot, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], {
      env: { ...process.env, H5VIDEO_WORK_ROOT: workRoot, ...extraEnv },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
    }, (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : (error ? 1 : 0), stdout, stderr })
    })
  })
}

/** 极简环境：PATH 只留一个空目录，用来稳定复现「缺 ffmpeg / ffprobe」的分支。 */
function bareEnv(root) {
  const empty = path.join(root, 'empty-path')
  fs.mkdirSync(empty, { recursive: true })
  return { PATH: empty, H5VIDEO_TOOLS_DIR: path.join(root, 'no-tools') }
}

test('check-env --json 返回稳定结构，且 work_root 等于会话工作区', async () => {
  const root = makeWorkRoot()
  try {
    const result = await h5video(['check-env', '--json'], root)
    assert.equal(result.code, 0)
    const report = JSON.parse(result.stdout)
    assert.equal(report.work_root, root)
    assert.equal(typeof report.ok, 'boolean')
    assert.equal(report.platform, process.platform)
    for (const key of ['ffmpeg', 'ffprobe']) {
      assert.ok(report[key], key + ' 字段缺失')
      assert.ok(report[key].path === null || typeof report[key].path === 'string')
      assert.ok('origin' in report[key] && 'version' in report[key])
    }
    assert.ok(path.resolve(report.skill.dir).endsWith(path.join('skills', 'h5-animation-video')))
    assert.ok(Array.isArray(report.warnings))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('scaffold 生成骨架，plan 只打印预估时间轴', async () => {
  const root = makeWorkRoot()
  try {
    const project = path.join(root, 'proj')
    const scaffold = await h5video(['scaffold', project], root)
    assert.equal(scaffold.code, 0, scaffold.stderr)
    for (const rel of ['animation.html', 'build.mjs', 'storyboard.cjs', 'script.json', 'qa-tts-audio.cjs', 'qa-katex.cjs', 'qa-frames.cjs', 'qa.cjs', 'tts-win.ps1', 'out', 'work', 'tools']) {
      assert.ok(fs.existsSync(path.join(project, rel)), '骨架缺少：' + rel)
    }
    assert.ok(fs.existsSync(path.join(project, 'vendor', 'katex', 'katex.min.js')))

    // 再跑一次：不覆盖已有文件
    fs.writeFileSync(path.join(project, 'script.json'), JSON.stringify({ fps: 30, segments: [{ id: 'title', text: '只有一段。' }] }))
    const again = await h5video(['scaffold', project], root)
    assert.equal(again.code, 0)
    assert.ok(again.stdout.includes('跳过'), '重复 scaffold 应跳过已有文件')

    const plan = await h5video(['plan', project], root)
    assert.equal(plan.code, 0, plan.stderr)
    assert.ok(plan.stdout.includes('预估时间轴'))
    assert.ok(plan.stdout.includes('30fps'))
    assert.ok(!plan.stdout.includes('chromium'), 'plan 不应启动浏览器')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('qa --static 在干净骨架上通过，缺项目时按 script.json 报错', async () => {
  const root = makeWorkRoot()
  try {
    const project = path.join(root, 'proj')
    await h5video(['scaffold', project], root)
    const pass = await h5video(['qa', project, '--static'], root)
    assert.equal(pass.code, 0, pass.stdout + pass.stderr)
    assert.ok(pass.stdout.includes('公式与排版'))
    assert.ok(pass.stdout.includes('出片前体检汇总'))
    const report = JSON.parse(fs.readFileSync(path.join(project, 'work', 'qa', 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.staticOnly, true)
    assert.equal(report.katex.ok, true)

    const missing = await h5video(['qa', path.join(root, 'nowhere')], root)
    assert.equal(missing.code, 1)
    assert.ok(missing.stderr.includes('script.json'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('doctor 给出分级自检报告，且缺件时给修复命令、不擅自安装', async () => {
  const root = makeWorkRoot()
  try {
    const result = await h5video(['doctor', '--json'], root)
    const report = JSON.parse(result.stdout)
    assert.equal(report.schema, 1)
    assert.equal(typeof report.ready, 'boolean')
    assert.ok(Array.isArray(report.blocking) && Array.isArray(report.degradable) && Array.isArray(report.checks))
    const ids = report.checks.map((c) => c.id)
    for (const id of ['node', 'skill-layout', 'workspace', 'ffmpeg', 'ffprobe', 'browser', 'tts', 'cjk-font']) {
      assert.ok(ids.includes(id), '自检缺少检查项：' + id)
    }
    for (const item of report.blocking) {
      assert.ok(item.why, 'blocking 项必须说明为什么必须：' + item.id)
      assert.ok(Array.isArray(item.fix) && item.fix.length > 0, 'blocking 项必须给出修复动作：' + item.id)
    }
    // 空 PATH 环境：必须报出缺失的二进制，并给出按平台的修复命令
    const bare = await h5video(['doctor', '--json'], root, bareEnv(root))
    const bareReport = JSON.parse(bare.stdout)
    const missing = bareReport.blocking.map((i) => i.id)
    assert.ok(missing.includes('ffmpeg') || missing.includes('ffprobe'), '空环境应报出缺失的二进制：' + JSON.stringify(missing))
    const ffmpegItem = bareReport.blocking.find((i) => i.id === 'ffmpeg' || i.id === 'ffprobe')
    assert.ok(ffmpegItem.fix.some((step) => step.includes('install-tools')), '修复命令应指向 install-tools 脚本：' + JSON.stringify(ffmpegItem.fix))
    // --fix 不带 --yes：只打印将执行的命令并退 3，不得真的下载
    const plan = await h5video(['doctor', '--fix'], root, bareEnv(root))
    assert.equal(plan.code, 3, '未确认的安装计划必须退 3：' + plan.stdout)
    assert.ok(plan.stdout.includes('即将执行'))
    assert.ok(!fs.existsSync(path.join(root, 'tools')), '--fix 不带 --yes 不得真的安装')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('build 没有 --approved 时由脚本闸门拦下（exit 2）', async () => {
  const root = makeWorkRoot()
  try {
    const project = path.join(root, 'proj')
    await h5video(['scaffold', project], root)
    const gated = await h5video(['build', project], root)
    assert.equal(gated.code, 2, 'build 未获批准必须退出码 2：' + gated.stdout + gated.stderr)
    assert.ok(gated.stderr.includes('尚未审核通过'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('缺少项目目录时给出可执行的提示，而不是堆栈', async () => {
  const root = makeWorkRoot()
  try {
    const result = await h5video(['storyboard', path.join(root, 'nowhere')], root)
    assert.equal(result.code, 1)
    assert.ok(result.stderr.includes('script.json'))
    const missingArgs = await h5video(['build'], root)
    assert.equal(missingArgs.code, 1)
    assert.ok(missingArgs.stderr.includes('用法'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('未知子命令退出码非 0 并打印帮助', async () => {
  const root = makeWorkRoot()
  try {
    const result = await h5video(['frobnicate'], root)
    assert.equal(result.code, 1)
    assert.ok(result.stderr.includes('未知子命令'))
    assert.ok(result.stdout.includes('check-env'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('probe 对不存在的文件报错退出', async () => {
  const root = makeWorkRoot()
  try {
    const result = await h5video(['probe', path.join(root, 'nope.mp4')], root)
    assert.equal(result.code, 1)
    assert.ok(result.stderr.includes('文件不存在'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('voices 解析 say 音色表，并能按 --query 过滤（仅 macOS）', { skip: process.platform !== 'darwin' }, async () => {
  const root = makeWorkRoot()
  try {
    const all = await h5video(['voices', '--all'], root)
    assert.equal(all.code, 0, all.stderr)
    assert.ok(all.stdout.includes('（全部）'))
    const voiceLines = all.stdout.split('\n').filter((line) => /^ {2}\S/.test(line))
    assert.ok(voiceLines.length >= 1, '应至少解析出一个音色：' + all.stdout)
    const firstName = voiceLines[0].trim().split(/\s{2,}/)[0]
    assert.ok(firstName.length > 0)

    const filtered = await h5video(['voices', '--all', '--query', firstName], root)
    assert.equal(filtered.code, 0, filtered.stderr)
    assert.ok(filtered.stdout.includes(firstName), '--query ' + firstName + ' 应命中自己：' + filtered.stdout)

    const zhOnly = await h5video(['voices'], root)
    assert.equal(zhOnly.code, 0, zhOnly.stderr)
    assert.ok(zhOnly.stdout.includes('（中文）'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
