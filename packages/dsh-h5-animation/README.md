# dsh-h5-animation

把 **h5-animation-video**（HTML/CSS/Canvas 动画 → 带中文旁白的 MP4）接入 DSH profile 的
**自包含组合包（bundle）**：挂载随包的 skill、注册一个 `h5video` 原生工具、并声明一个
「H5 动画视频」agent preset。

这是一个**薄适配**：不含任何创作判断。文案、构图、节奏仍由宿主 agent 决定，
确定性环节（量时长、逐帧截图、编码、混流、探测）仍由 skill 的脚本与静态 ffmpeg 完成。
**CLI 永远是退路**——插件坏了，bash 里 `node storyboard.cjs` / `node build.mjs --approved` 照样能跑。

## 结构

    packages/dsh-h5-animation/
      package.json               dsh.bundle.patch = ./cordis.patch.yml；同时是可挂载的插件入口
      cordis.patch.yml           自带组合包：插入 preset-h5-animation（含 skill 挂载 + 原生工具行）
      tools/index.js             宿主半侧插件：注册 h5video 原生工具（argv 透传 CLI）
      tools/cli.mjs              确定性 CLI（check-env / scaffold / plan / storyboard / build / probe / voices）
      skills/h5-animation-video/ 随包 skill（仓库根 SKILL.md 等文件的同步副本，脚本生成，勿手改）
      scripts/sync-skill.mjs     生成 / 校验随包 skill 副本（--check 用于 CI 与本地守一致性）
      test/                      打包契约测试 + CLI 行为测试（node --test，无外部依赖）
      locale/{zh,en}.json        插件管理页的标题与描述
      icon.svg                   插件卡片图标
      host-probe/README.md       真实 DSH 会话里的验收清单
      README.md

## 它做了什么

- **agent preset「H5 动画视频」（id `h5-animation`）**：自带完整 plugins 列表
  （与内置 `ptc` preset 同构，含 bash / fs / subagent / todo / web / present / goal / plan / compaction），外加：
  - `skill-filesystem` 的 `customSkillDirs` 指向本包 `skills/`，所以 h5-animation-video skill
    只在这个 preset 的会话里可见（DSH 的 skill 发现按 preset 分层）；
  - `./tools/index.js` 注册原生工具 `h5video`；
  - persona 中写入课程范围与演示节奏要求：高中同步课程不提前讲后续知识；不同情况先分开演示、末尾按需比较；动画单次播放后停止；阶段二 HTML 带默认中文语音试听。
  - persona 里写死**三阶段闸门**：先交 `design.md` 详细方案，用户明确确认前不生成 HTML；方案确认后再交带语音预览的 `animation.html` + 分镜审核；HTML 审核明确同意前不调用 `build`，`--approved` 不是可以绕过的形式。
- **原生工具 `h5video`**：参数 `args: string[]` 原样透传给 CLI，返回
  `exitCode / stdout / stderr / truncated`。它走宿主平面的 `ctx.subprocess`（子进程服务会清洗环境变量），
  不是 bash；每次调用从会话读取工作区作为 cwd，并注入 `H5VIDEO_WORK_ROOT`。
- **确定性 CLI**：

  | 子命令 | 作用 |
  | --- | --- |
  | `check-env [--json]` | ffmpeg / ffprobe / `say` / Chromium / skill 布局体检。`--json` 输出含 `work_root`、`ok`、`warnings` |
  | `scaffold <目录>` | 从随包 templates 生成项目骨架（不覆盖已有文件），并把可用的 ffmpeg / ffprobe 链进项目 `tools/` |
  | `plan <项目>` | 只打印预估时间轴（不开浏览器、不需要 ffmpeg） |
  | `storyboard <项目> [--shots N] [--at t...]` | 阶段二：按预估时间轴出分镜图，交人审核 |
  | `build <项目> --approved [--reuse-tts] [--keep-frames]` | 阶段三：TTS → 逐帧定格录制 → H.264 编码 → 混流（没有 `--approved` 由脚本 exit 2 拦下） |
  | `probe <媒体文件>` | ffprobe 结构化探测（JSON），用于出片校验 |
  | `voices [--query 文本] [--all]` | `say` 音色列表（默认只看中文），填进 `script.json` 的 `voice` |

  CLI 只用 Node 内建模块，**不 import 任何 `@deepseek-ai/*` 包**：profile 里不一定解析得到随 DSH 安装的包。

## 安装

本 bundle 不包含 ffmpeg / ffprobe 二进制（合计 100MB+），也不包含 Playwright 与 Node。先备齐：

- **Node 18+**（宿主进程跑在 Electron 里，`process.execPath` 不是 node；插件按
  显式 `nodePath` → PATH → Homebrew / volta / fnm / nvm 安装目录的顺序查找真正的 node）。
- **Playwright Chromium**：`npx playwright install chromium`（分镜与逐帧录制都要用它）。
- **ffmpeg / ffprobe**（按平台取，随包 skill 里也带着这两个脚本）：

  | 平台 | 命令 |
  | --- | --- |
  | macOS / Linux | `cd "<项目>" && ./tools/install-tools.sh` |
  | Windows | `powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1` |
  | 任意（系统包管理器） | `brew install ffmpeg` / `winget install Gyan.FFmpeg` |

  两个脚本都会**实际跑一次 `-version`** 判断可用性，坏的重下（arm64 机器上 x86_64 的 ffprobe
  也是「可执行」的，但一跑就 `Bad CPU type in executable`）。别用 Playwright 自带的 ffmpeg：
  它没有 libx264、adelay、apad。
- **旁白**：macOS 用内置 `say`；Linux / Windows 没有 `say`，先按 `script.json` 的段序生成
  `work/segN.aiff`（Windows 可用 PowerShell 的 `System.Speech`），再 `build --approved --reuse-tts`。
  细节见随包 skill 的 `references/pipeline.md` 第 9.4 节，`h5video check-env` 也会在缺 `say` 时提示。

安装 bundle：

- **图形界面**：侧栏「插件」页 → 按**本地路径**安装本包目录：
  `<仓库根>/packages/dsh-h5-animation`
- **creator 模式会话**：`plugin_manager`，`action: install_bundle`，
  `target` = 本包目录的绝对路径。

安装会把本包登记进 profile 的 `dsh.profile.bundles` 与 `dependencies`。
新增 bundle 可能经 HMR 立即生效；**替换已安装的包需要重启**才能加载新的 JS 模块代际。

## 启用与验证

1. 安装后确认 bundle 在「插件」页列出、行 `preset-h5-animation` 激活。
2. **新开**一个会话，在 agent preset 里选「H5 动画视频」（或在「设置 → 通用」把它设为之后会话的默认）。
3. 验证 skill：会话的 skill 目录里应出现 `h5-animation-video`；加载它返回 SKILL.md 正文。
4. 验证工具：调用 `h5video`，`args: ["check-env", "--json"]`，确认 `ok`、`work_root` 等于当前工作区、
   `skill.dir` 指向本包 `skills/h5-animation-video`。
5. 开一个新工作区再调一次，确认 `work_root` 跟着变（检验会话注入，而不是宿主进程 cwd）。
6. 完整走一遍三阶段流程，见 [host-probe/README.md](host-probe/README.md)。

## 配置（profile patch 按行 id 覆盖）

    - id: h5video-tools
      name: dsh-h5-animation
      config:
        nodePath: /绝对路径/bin/node        # 省略时自动探测
        toolsDir: /绝对路径/tools           # 放 ffmpeg / ffprobe 的目录，注入 H5VIDEO_TOOLS_DIR
        timeoutMs: 1800000                  # 默认 30 分钟（长视频逐帧录制很慢）
        maxOutputBytes: 262144              # 默认 256 KiB
        cliPath: /绝对路径/tools/cli.mjs     # 一般不用改

`h5video` 每次调用从会话读取工作区 W，并以 W 为 cwd；会话缺少绝对工作区时拒绝执行。
普通调用只传 `args`（及必要的 cwd 兼容字段），不要主动填写权限升级字段。

## 随时插拔

- **插上**：安装 bundle → 新会话里出现「H5 动画视频」preset + `h5video` 工具 + 随包 skill。
- **拔掉**：在「插件」页停用 / 卸载该 bundle（或把 preset 换回 `ptc` / `standard`），
  工作流整体消失，不影响其它会话与全局 `~/.dsh/skills/` 里的注册。
- preset 行 id 固定为 `preset-h5-animation`，profile patch 可按 id 覆盖它的配置或 `disabled: true`。

## 已知限制

- preset 的 plugins 列表是内置 `ptc` preset 的副本：DSH 的 preset 不提供继承，
  公共能力行变更时需要同步。这是「薄适配」当前最脆的一处（契约测试只守必要行还在）。
- 随包 skill 是仓库源文件的**同步副本**（`node scripts/sync-skill.mjs` 生成，`--check` 校验）；
  改 skill 请改仓库源文件再同步，别手改副本。
- 静态 ffmpeg / ffprobe 不随包：随包会带来 100MB+ 体积，且二进制需要与平台架构匹配。
  `check-env` 会**实际执行**每个候选（而不是只检查文件存在）：arm64 机器上 x86_64 的
  `ffprobe` 会被判为不可用并跳过，并给出 `@ffprobe-installer/darwin-arm64` / `brew install ffmpeg`
  这类按架构的替代建议。
- 原生工具**不是** bash 沙箱的替代：它只调用受信任的本地 CLI，不应对它传任意 shell。
- 出片质量（画面、节奏、音画对齐）必须由宿主验收，自动测试只覆盖打包契约与 CLI 行为。
