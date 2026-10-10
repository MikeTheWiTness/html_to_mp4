# h5动画演示

把 **HTML 动画导出成带中文旁白的 MP4** 的完整技能包，外加一个跑通的样例。

- 技能本体：[SKILL.md](SKILL.md)（DSH / Claude 等 Agent 读的就是它）
- 参考手册：[references/pipeline.md](references/pipeline.md)（环境、参数、故障排查）、[references/scene-cookbook.md](references/scene-cookbook.md)（可复制的绘制片段）
- 项目骨架：[templates/](templates)
- 成品样例：[examples/物理动态演示/](examples/物理动态演示/) —— 42 秒、2.7 MB 的白底物理演示视频，含旁白文案、时间轴和分镜帧
- 离线工具：[tools/](tools) 里的静态 ffmpeg / ffprobe
- DSH 插件包：[packages/dsh-h5-animation/](packages/dsh-h5-animation/) —— 把本 skill 挂成可插拔的 agent preset（「H5 动画视频」），并注册 `h5video` 确定性工具
- 视觉基线：**纯白底 + 深墨字 + 单一强调色（蓝 #2563eb / 暖橙 #f97316）**，见 [SKILL.md](SKILL.md) 的画面设计规范
- 公式排版：物理量与公式一律走 **LaTeX（KaTeX）**，真分数、带横线的根号、上下标、希腊字母都是真排版；KaTeX 随包在 `templates/vendor/katex/`（字体已内联，离线可用）

## 核心思路

不是录屏，而是**把动画定格在每一帧再截图**：

~~~text
旁白文案 → say 合成语音 → ffprobe 量出真实时长
        → 用语音时长反推每段画面时长（lead + 语音 + tail）
        → 无头 Chromium 逐帧 window.__seek(f/30) + 截图
        → ffmpeg 编码 H.264 并与音轨混流
~~~

所以不掉帧、不受机器负载影响、音画天然同步、结果可复现。

## 三阶段交付（重要）

先确认详细设计，再生成 HTML 供审核，审核通过后才编码出片。

| 阶段 | 命令/动作 | 产出 | 交付对象 |
| --- | --- | --- | --- |
| 一 · 设计 | 编写 `design.md` | 课程范围、场景顺序、旁白与时长的详细方案 | 交用户确认；确认前不生成 HTML |
| 二 · HTML | `node storyboard.cjs` | `animation.html` + 分镜图 + 语音预览 | 交用户审核；明确确认后才出片 |
| 三 · 出片 | `node build.mjs --approved` | `out/*.mp4` | 最终交付 |


## 快速开始

~~~bash
cd templates
./setup.sh ~/我的视频项目
cd ~/我的视频项目
# 阶段一：先写 design.md（课程目标、范围、分镜顺序、旁白、时长），交用户确认
# 方案确认后进入阶段二
# 2) 改 script.json 的旁白、改 animation.html 的画面
node storyboard.cjs --plan     # 先看预估节奏
node storyboard.cjs            # 出分镜图，交审核，按反馈迭代
# HTML、分镜和语音明确通过后进入阶段三
node build.mjs --approved      # 只改了画面时加 --reuse-tts，跳过重新配音
~~~

## 在 DSH 里使用

### 方式一：装成插件包（推荐，可随时插拔）

[packages/dsh-h5-animation/](packages/dsh-h5-animation/) 是一个自包含的 DSH 组合包（bundle）：
挂载随包 skill、注册 `h5video` 确定性工具，并声明一个「H5 动画视频」agent preset。

- **图形界面**：侧栏「插件」页 → 按**本地路径**安装 `packages/dsh-h5-animation`
- **creator 模式会话**：`plugin_manager`，`action: install_bundle`，`target` = 该目录的绝对路径

装好后**新开**一个会话，在 agent preset 里选「H5 动画视频」，skill 与 `h5video` 工具就在里面；
不想用了就在「插件」页停用 / 卸载，或在 profile patch 里把 `preset-h5-animation` 置 `disabled: true`，
工作流整体消失。细节与配置项见 [packages/dsh-h5-animation/README.md](packages/dsh-h5-animation/README.md)。

装了插件后，确定性步骤可以走原生工具（和 bash 里的脚本等价，闸门相同）：

~~~bash
h5video doctor [--json]      # 阶段零自检：分级缺件 + 修复命令（--fix --yes 才真的安装）
h5video check-env --json     # 轻量体检：ffmpeg / ffprobe / say / Chromium
h5video scaffold 我的视频项目  # 生成项目骨架（不覆盖已有文件）
h5video plan 我的视频项目      # 只打印预估时间轴
h5video storyboard 我的视频项目            # 阶段二：出分镜
h5video build 我的视频项目 --approved      # 阶段三：出片
h5video probe 我的视频项目/out/video.mp4   # 出片校验
~~~

### 方式二：只注册 skill（不用插件）

~~~bash
# 全局（任何项目都能用）
ln -s "/Users/chouchou/开发/h5动画演示" ~/.dsh/skills/h5-animation-video
# 或只给某个项目
ln -s "/Users/chouchou/开发/h5动画演示" "<项目>/.dsh/skills/h5-animation-video"
~~~

注册后新开一个会话，`h5-animation-video` 就会出现在技能目录里。

## 环境

任何平台都需要：**Node 18+** + **Playwright Chromium**（`npx playwright install chromium`）
+ **静态 ffmpeg / ffprobe**。ffmpeg / ffprobe 按平台获取，两个脚本都会实际跑一次 `-version` 自检，
坏的就重下（arm64 机器上 x86_64 的 ffprobe 看着可执行，一跑就 `Bad CPU type in executable`）：

~~~bash
cd "<项目>" && ./tools/install-tools.sh                        # macOS / Linux
powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1   # Windows
brew install ffmpeg                                            # 或用系统包管理器
~~~

**旁白**用的是 macOS 内置的 `say`。Linux / Windows 没有它：先按 `script.json` 的段序生成
`work/segN.aiff`（Windows 可用 PowerShell 的 `System.Speech`），再 `node build.mjs --approved --reuse-tts`；
时长仍由 ffprobe 实测，音画同步公式不变。平台差异、Windows 例子与完整细节见
[SKILL.md](SKILL.md) 的「平台支持」与 [references/pipeline.md](references/pipeline.md) 第 9.3 / 9.4 节。
