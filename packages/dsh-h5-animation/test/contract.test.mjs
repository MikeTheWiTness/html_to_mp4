/**
 * dsh-h5-animation 的打包契约测试。
 *
 * 只锁定「随包产物彼此一致、且是 DSH 能读的形态」，不验证宿主运行行为
 * （安装与实际会话需要真实 DSH profile，见 host-probe/README.md）。
 * 不引入任何依赖：cordis.patch.yml 用结构化字符串断言检查，不做完整 YAML 解析。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { diff } from '../scripts/sync-skill.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = path.join(PKG, 'skills', 'h5-animation-video')
const read = (rel) => fs.readFileSync(path.join(PKG, rel), 'utf8')
const PATCH = read('cordis.patch.yml')

test('清单声明了 bundle patch、插件入口与展示元数据', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.name, 'dsh-h5-animation')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(fs.existsSync(path.join(PKG, manifest.dsh.bundle.patch)))
  // 同名包既要能被相对路径挂载，也要能按包名解析（自引用 package.json）
  assert.equal(manifest.exports['.'], './tools/index.js')
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.ok(manifest.icon.startsWith('./'))
  assert.ok(manifest.files.includes('skills/'))
  for (const locale of ['zh', 'en']) {
    const file = JSON.parse(read(path.join('locale', locale + '.json')))
    assert.ok(file.meta.title.length > 0)
    assert.ok(file.meta.description.length > 0)
    assert.match(file.meta.description, locale === 'zh' ? /三阶段闸门/ : /three gated phases/)
    assert.doesNotMatch(file.meta.description, /两阶段|two gated phases/)
  }
})

test('preset 声明了完整的 agent 能力，且不依赖继承', () => {
  assert.match(PATCH, /id:\s*preset-h5-animation/)
  assert.match(PATCH, /id:\s*h5-animation\b/)
  assert.match(PATCH, /name:\s*H5 动画视频/)
  assert.match(PATCH, /order:\s*\d+/)
  // 预设必须自带完整 plugins 列表（DSH 不提供继承）：抽查核心能力仍在
  for (const required of [
    "id: persona",
    "id: agent-instructions",
    "id: tool-bash",
    "id: tool-fs",
    "id: tool-fs-search",
    "id: tool-jobs",
    "id: tool-skill",
    "id: tool-ask-user",
    "id: tool-todo",
    "id: tool-web",
    "id: present",
    "id: command-goal",
    "id: tool-goal",
    "id: planning",
    "id: compaction",
    "id: delegation",
  ]) {
    assert.ok(PATCH.includes(required), 'preset 缺少公共能力：' + required)
  }
  assert.ok(PATCH.includes("id: tool-subagent") && PATCH.includes("id: tool-subagent-fork"))
  // 三阶段审核闸门必须写进 persona，防止 preset 会话提前生成 HTML 或出片
  for (const required of ['design.md', '三阶段闸门', '用户明确确认', '不得创建/生成最终 animation.html', 'storyboard 或 build']) {
    assert.ok(PATCH.includes(required), 'preset 缺少阶段审核约束：' + required)
  }
  assert.match(PATCH, /approved/)
  for (const required of ['高中同步课程', '平抛', '不循环', 'speechSynthesis', '阶段二 HTML', '逐段对应']) {
    assert.ok(PATCH.includes(required), 'preset persona 缺少创作约束：' + required)
  }
  // 阶段零：开工前自检 + 缺件先问用户，不许擅自下载、不许跳过自检
  for (const required of ['阶段零', 'h5video doctor', '--fix --yes', 'env-report.json', '不要替用户擅自下载']) {
    assert.ok(PATCH.includes(required), 'preset persona 缺少阶段零自检约束：' + required)
  }
  for (const required of ['tts-win.ps1', 'Windows']) {
    assert.ok(PATCH.includes(required), 'preset persona 缺少平台旁白约束：' + required)
  }
})

test('skill 与 HTML 模板明确课程顺序、旁白预览和单次播放', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8')
  const html = fs.readFileSync(path.join(SKILL, 'templates', 'animation.html'), 'utf8')
  assert.match(skill, /课程内容与演示节奏/)
  assert.match(skill, /阶段二旁白要求/)
  assert.match(skill, /后续换音色/)
  assert.match(skill, /阶段一先交 `design\.md`/)
  assert.match(skill, /不要创建\/生成最终 `animation\.html`/)
  // 阶段零：自检入口、缺件先问、镜像与平台目标必须写给 agent
  assert.match(skill, /## 阶段零/)
  assert.match(skill, /h5video doctor/)
  assert.match(skill, /H5VIDEO_MIRROR/)
  assert.match(skill, /征得用户同意/)
  assert.match(skill, /Linux 不保证/)
  assert.match(skill, /eloquence/)
  assert.match(skill, /qa-tts-audio\.cjs/)
  assert.match(skill, /qa-katex\.cjs/)
  assert.match(skill, /qa-frames\.cjs/)
  assert.match(skill, /出片前体检（qa）/)          // 体检一节必须写进 skill
  assert.match(skill, /h5video qa/)                  // 插件入口也要暴露
  assert.match(skill, /tts-win\.ps1/)
  assert.match(html, /id="replay"/)
  assert.match(html, /window\.__MATH\s*=/)           // 公式体检依赖这个出口
  assert.match(html, /window\.__SCENES\s*=/)
  assert.match(html, /if \(t < TOTAL\) raf = requestAnimationFrame\(loop\)/)
  assert.ok(!html.includes('t % TOTAL'), '模板不得自动循环播放')
})

test('preset 挂载随包 skill 目录，并注册原生工具', () => {
  assert.match(PATCH, /id:\s*skill-filesystem/)
  assert.ok(PATCH.includes('customSkillDirs'))
  assert.ok(PATCH.includes('baseUrl'))
  assert.ok(PATCH.includes("resolve('dsh-h5-animation/package.json')"))
  assert.ok(PATCH.includes("'skills'"))
  assert.match(PATCH, /id:\s*h5video-tools/)
  assert.match(PATCH, /name:\s*dsh-h5-animation/)
})

test('原生工具模块不依赖 @deepseek-ai/*，且用的是受管子进程', () => {
  const source = read('tools/index.js')
  assert.ok(source.includes('export function apply'))
  assert.ok(source.includes('export const inject'))
  assert.ok(source.includes("inject = ['tools', 'subprocess']"))
  assert.ok(source.includes('ctx.tools.register'))
  assert.ok(source.includes('ctx.subprocess.spawn'))
  assert.ok(source.includes("name: 'h5video'"))
  assert.ok(!source.includes("from '@deepseek-ai/"))
  assert.ok(!source.includes('from "@deepseek-ai/'))
  assert.ok(!source.includes("import('@deepseek-ai/"))
})

test('随包 skill 的 frontmatter 可被发现', () => {
  const text = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8')
  assert.ok(text.startsWith('---'))
  assert.ok(text.includes('\nname: h5-animation-video\n'))
  assert.ok(text.includes('\ndescription:'))
})

test('随包 skill 与仓库源逐字节一致（副本是生成物）', () => {
  const { missing, changed, extra } = diff()
  assert.deepEqual(missing, [], '随包 skill 缺少文件：' + missing.join('、'))
  assert.deepEqual(changed, [], '随包 skill 内容不一致：' + changed.join('、'))
  assert.deepEqual(extra, [], '随包 skill 有多余文件：' + extra.join('、'))
})

test('随包 skill 带上了流程必需的文件，且不夹带静态二进制', () => {
  for (const rel of [
    'SKILL.md',
    'README.md',
    'references/pipeline.md',
    'references/scene-cookbook.md',
    'templates/animation.html',
    'templates/build.mjs',
    'templates/storyboard.cjs',
    'templates/script.json',
    'templates/setup.sh',
    'templates/qa-tts-audio.cjs',
    'templates/qa-katex.cjs',
    'templates/qa-frames.cjs',
    'templates/qa.cjs',
    'templates/tts-win.ps1',
    'templates/vendor/katex/katex.min.js',
    'templates/vendor/katex/katex-inline.css',
    'examples/物理动态演示/animation.html',
    'examples/物理动态演示/script.json',
    'tools/install-tools.sh',
  ]) {
    assert.ok(fs.existsSync(path.join(SKILL, rel)), '随包 skill 缺少：' + rel)
  }
  for (const rel of ['tools/ffmpeg', 'tools/ffprobe', 'outputs', '_dsh-archive', 'packages']) {
    assert.ok(!fs.existsSync(path.join(SKILL, rel)), '随包 skill 不应包含：' + rel)
  }
})
