/**
 * dsh-h5-animation 的宿主半侧。
 *
 * 这里只做「argv 透传 + 受管子进程 + 结构化返回」，不含任何创作判断：
 * 真正的确定性逻辑在 ./cli.mjs（CLI 是永久退路，见 SKILL.md 的两阶段闸门）。
 * 本模块刻意不 import 任何 @deepseek-ai/* 包，避免 profile 内解析不到随 DSH
 * 安装的包；只用 Node 内建模块。
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'h5-animation-tools'

/** 依赖宿主平面的工具注册表与子进程服务（两者都在 dsh-base 里随宿主挂载）。 */
export const inject = ['tools', 'subprocess']

const DESCRIPTION = [
  '运行 h5video 确定性流程 CLI，参数原样透传，返回退出码与标准输出 / 错误。',
  '常用：check-env [--json]（ffmpeg / ffprobe / say / Chromium 体检）；scaffold <目录>（生成项目骨架）；',
  'plan <项目>（只打印预估时间轴）；storyboard <项目> [--shots N] [--at t...]（阶段一：出分镜图交人审核）；',
  'build <项目> --approved [--reuse-tts] [--keep-frames]（阶段二：TTS → 逐帧录制 → 编码 → 混流）；',
  'probe <媒体文件>（ffprobe JSON）；voices [--query 文本]（say 音色）。',
  '铁律：阶段一审核通过前不要调用 build；build 没有 --approved 会 exit 2，这是刻意的闸门，不要绕过。',
  '创作判断不要放进这里：它是确定性工具，不会调用任何模型。',
].join(' ')

/** 随包的 CLI 入口，与宿主半侧同目录。 */
function defaultCli() {
  return fileURLToPath(new URL('./cli.mjs', import.meta.url))
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * 候选 Node 解释器：显式配置 → PATH → 常见安装位置 → nvm / fnm 最新版。
 * 宿主进程跑在 Electron 里，process.execPath 不是 node，所以不能直接拿它当解释器；
 * 找不到真正的 node 时明确报错，让调用方回退到 bash（skill 的脚本本来就是脚本）。
 */
function compareVersionsDesc(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function latestVersionDirs(root) {
  try {
    return readdirSync(root).sort(compareVersionsDesc)
  } catch {
    return []
  }
}

function nodeCandidates(config) {
  const list = []
  const push = (command, env) => {
    if (typeof command === 'string' && command.length > 0 && !list.some((item) => item.command === command)) {
      list.push({ command, env })
    }
  }
  if (typeof config.nodePath === 'string' && config.nodePath.length > 0) push(config.nodePath)
  if (typeof process.env.H5VIDEO_NODE === 'string' && process.env.H5VIDEO_NODE.length > 0) push(process.env.H5VIDEO_NODE)
  push('node')
  const home = homedir()
  push('/opt/homebrew/bin/node')
  push('/usr/local/bin/node')
  push(join(home, '.volta', 'bin', 'node'))
  // fnm：PATH 里往往只有当前 shell 的 multishell 目录，宿主进程看不见，所以直接按安装目录找。
  push(join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node'))
  for (const dir of latestVersionDirs(join(home, '.local', 'share', 'fnm', 'node-versions'))) {
    push(join(home, '.local', 'share', 'fnm', 'node-versions', dir, 'installation', 'bin', 'node'))
  }
  // nvm
  for (const dir of latestVersionDirs(join(home, '.nvm', 'versions', 'node'))) {
    push(join(home, '.nvm', 'versions', 'node', dir, 'bin', 'node'))
  }
  // 最后兜底：把 Electron 自身当 node 跑（ELECTRON_RUN_AS_NODE）。宿主若本来就是 node，该变量无副作用。
  push(process.execPath, { ELECTRON_RUN_AS_NODE: '1' })
  return list
}

/** 把一次收集读数转成文本，缺失读数为空串。 */
function readText(reader) {
  if (reader === undefined) return { text: '', lossy: false }
  const read = reader.readFrom(0)
  return { text: read?.text ?? '', lossy: Boolean(read?.lossy) }
}

/** 收尾渲染：退出码 + 两路输出，供模型直接阅读。 */
function render(args, value) {
  const argv = Array.isArray(args?.args) ? args.args.join(' ') : ''
  const lines = ['$ h5video ' + argv, 'exitCode: ' + value.exitCode]
  if (value.truncated) lines.push('（输出超过上限，已截断）')
  if (value.stdout.length > 0) lines.push('--- stdout ---', value.stdout)
  if (value.stderr.length > 0) lines.push('--- stderr ---', value.stderr)
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 注册 h5video 工具。
 * @param ctx - 携带 tools / subprocess 服务的上下文。
 * @param config - cliPath、nodePath、toolsDir（ffmpeg/ffprobe 所在目录）、timeoutMs、maxOutputBytes。
 */
export function apply(ctx, config = {}) {
  const cliPath = typeof config.cliPath === 'string' && config.cliPath.length > 0 ? config.cliPath : defaultCli()
  const toolsDir = typeof config.toolsDir === 'string' && config.toolsDir.length > 0 ? config.toolsDir : undefined
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 1800000
  const maxOutputBytes = Number.isFinite(config.maxOutputBytes) && config.maxOutputBytes > 0 ? config.maxOutputBytes : 262144

  async function resolveNode() {
    const candidates = nodeCandidates(config)
    for (const candidate of candidates) {
      // 绝对路径先确认存在，省掉一次失败解析。
      if (isAbsolute(candidate.command) && !isFile(candidate.command)) continue
      try {
        const executable = await ctx.subprocess.resolveExecutable(candidate.command)
        if (executable) return { executable, env: candidate.env }
      } catch {
        // 继续尝试下一个候选
      }
    }
    return null
  }

  ctx.tools.register({
    name: 'h5video',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['args'],
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'h5video 之后的完整参数，按 CLI 原样写成数组，例如 ["check-env", "--json"]、["storyboard", "<项目目录>"]、["build", "<项目目录>", "--approved"]。',
        },
        cwd: {
          type: 'string',
          description: '兼容参数；必须与当前会话工作区一致。工作区每次调用从会话取得。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['exitCode', 'stdout', 'stderr', 'truncated'],
        properties: {
          exitCode: { type: 'integer', description: '进程退出码；未能取得时为 -1。' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          truncated: { type: 'boolean', description: '输出是否超过收集上限。' },
        },
      },
      render,
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const argv = Array.isArray(args?.args) ? args.args.map(String) : []
      if (argv.length === 0) throw new Error('h5video: args 不能为空，例如 ["check-env", "--json"]')
      if (!existsSync(cliPath)) throw new Error('h5video: 找不到 CLI 入口 ' + cliPath)
      const session = exec?.agent?.session
      const headerCwd = session?.header?.cwd
      if (typeof headerCwd !== 'string' || !isAbsolute(headerCwd)) {
        throw new Error('h5video: 当前会话缺少绝对工作区路径，请先打开工作区')
      }
      // 可选服务通过 get 查询；Cordis 会拒绝直接读取未声明 inject 的属性。
      let cwd = headerCwd
      try {
        const policy = ctx.get('sandboxPolicy')
        const root = policy?.resolve({ session })?.workspaceRoot
        if (typeof root === 'string' && root.length > 0) cwd = root
      } catch {
        // 没有沙箱策略服务时，退回会话头里的工作区
      }
      cwd = realpathSync(cwd)
      if (args?.cwd && (!isAbsolute(args.cwd) || realpathSync(args.cwd) !== cwd)) {
        throw new Error('h5video: cwd 必须等于当前会话工作区绝对路径')
      }
      const node = await resolveNode()
      if (!node) {
        throw new Error('h5video: 找不到 node 解释器。请安装 Node 18+ 并确保 PATH 可见，或在本 preset 的 h5video-tools 行用 config.nodePath 指定绝对路径；也可以直接用 bash 跑 skill 的脚本。')
      }
      if (exec?.signal?.aborted) {
        const cancelled = new Error('h5video: 用户已取消')
        cancelled.name = 'AbortError'
        throw cancelled
      }
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signals = []
      if (exec?.signal) signals.push(exec.signal)
      signals.push(timeoutSignal)
      const env = { H5VIDEO_WORK_ROOT: cwd }
      if (toolsDir) env.H5VIDEO_TOOLS_DIR = toolsDir
      if (node.env) Object.assign(env, node.env)
      const handle = ctx.subprocess.spawn({
        argv: [node.executable, cliPath, ...argv],
        cwd,
        env,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: maxOutputBytes },
        },
        graceMs: 5000,
        signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
      })

      try {
        const outcome = await handle.done
        if (exec?.signal?.aborted) {
          const cancelled = new Error('h5video: 用户已取消')
          cancelled.name = 'AbortError'
          throw cancelled
        }
        const stdout = readText(handle.collected.stdout)
        const stderr = readText(handle.collected.stderr)
        return {
          exitCode: typeof outcome?.exitCode === 'number' ? outcome.exitCode : -1,
          stdout: stdout.text,
          stderr: stderr.text,
          truncated: stdout.lossy || stderr.lossy,
        }
      } catch (error) {
        if (exec?.signal?.aborted) {
          const cancelled = new Error('h5video: 用户已取消')
          cancelled.name = 'AbortError'
          throw cancelled
        }
        const stdout = readText(handle.collected.stdout)
        const stderr = readText(handle.collected.stderr)
        return {
          exitCode: -1,
          stdout: stdout.text,
          stderr: (stderr.text.length > 0 ? stderr.text + '\n' : '') + String(error?.message ?? error),
          truncated: stdout.lossy || stderr.lossy,
        }
      }
    },
  })
}
