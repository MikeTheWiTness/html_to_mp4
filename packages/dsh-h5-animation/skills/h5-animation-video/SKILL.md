---
name: h5-animation-video
description: Produce a narrated MP4 from a self-contained HTML/CSS/Canvas animation in two gated phases — first build the reviewable HTML plus storyboard stills and get human sign-off, and only then synthesize Chinese narration with macOS say, seek every frame deterministically in headless Chromium, and encode H.264 + AAC with a static ffmpeg. Use when asked to make a 演示视频 / 动画视频 / 课件视频 / 宣传短片 from HTML, to add 旁白/配音 to an H5 animation, or to export an interactive HTML demo as MP4 for class, PPT, WeChat or social sharing.
---

# H5 动画 → MP4（含旁白）

把一段网页动画变成可播放的视频，画面、公式与旁白天然同步。全程离线：不用录屏软件、不依赖云 TTS、不需要手工对时间轴。

## 铁律：先出 HTML，审核通过再出片

这个流程**分两个阶段交付，不要一步到位**：

| 阶段 | 产出 | 谁看 | 命令 |
| --- | --- | --- | --- |
| 一 · 画面 | `animation.html` + 分镜图 + 旁白稿 + 预估时间轴 | **交人审核** | `node storyboard.cjs` |
| 二 · 出片 | `out/*.mp4`（H.264 + AAC + 旁白） | 交付 | `node build.mjs --approved` |

- 阶段一没通过审核之前，**不要**运行 `build.mjs`。它没有 `--approved` 会直接退出（exit 2），这是刻意设的闸门，不是 bug，也不要绕过。
- 审核意见经常推翻画面结构；而编码是整条链路里最贵的一步（要渲染几百到上千帧）。先把便宜的东西（文案、构图、节奏）定死，再花算力。
- 阶段一交付时必须把两样东西给对方：**分镜 PNG**（静态可贴进聊天/文档）+ **`animation.html` 本体**（浏览器打开即自动播放，能看真实动态）。
- 拿到反馈后只改 `animation.html` / `script.json`，重新跑 `storyboard.cjs`，直到对方明确说"可以"。收到明确同意后才进阶段二。

## 何时用

- 要把 HTML/CSS/Canvas/SVG 动画导出成可播放、可分享的视频（课堂讲解、微课、宣传短片、PPT 插片）。
- 要给已有的 H5 演示加中文旁白。
- 需要稳定可复现的渲染结果：逐帧定格，不掉帧，与机器性能无关。

**不适用**：真人出镜/录屏、需要摄像头麦克风的场景、必须实时交互（点击、拖拽、滚动）才能展示的内容。交互内容请先改写成自动播放的时间轴动画，再走本流程。

## 目录约定

~~~text
<项目>/
├── animation.html       画面本体；暴露 window.__seek(t) 与 window.__VM，可独立用浏览器打开
├── vendor/katex/        KaTeX（LaTeX 公式渲染；字体已内联进 CSS，离线可用）
├── script.json          旁白文案与参数（音色/语速/留白/帧率/分辨率/输出名）
├── storyboard.cjs       阶段一：按预估时间轴出分镜图，供人工审核
├── build.mjs            阶段二：TTS → 量时长 → 录制 → 编码 → 混流（需 --approved）
├── tools/               ffmpeg / ffprobe（静态二进制）与 install-tools.sh / .ps1（按平台获取）
├── work/
│   ├── storyboard/      分镜图（审核用）
│   ├── segN.aiff/.wav   分段旁白
│   ├── narration.wav    完整旁白轨
│   └── timeline.json    真实时间轴（出片后）
└── out/<name>.mp4       成品
~~~

用 [templates/setup.sh](templates/setup.sh) 一键生成项目骨架。完整可跑的成品样例见 [examples/物理动态演示/](examples/物理动态演示)。

## 阶段一：产出可审核的 HTML

1. **写旁白**：编辑 `script.json` 的 `segments[].text`，每段一句。`id` 必须与 `animation.html` 里 `SCENES` 的键一致。
2. **写画面**：在 `animation.html` 里为每个 id 写一个 `sceneXxx(lt, dur)`（`lt` 是场景内秒数），注册进 `SCENES`。绘制片段可直接抄 [references/scene-cookbook.md](references/scene-cookbook.md)。画面里的物理量与公式用 `math({...})` 声明成 LaTeX（见该文件第 11 节），不要在 canvas 上拼字符。
3. **出分镜**：
   ~~~bash
   node storyboard.cjs                # 每个场景自动抽 2 帧（25% / 75% 处）
   node storyboard.cjs --shots 3      # 每场景抽 3 帧
   node storyboard.cjs --at 2.5 9 16  # 只抽指定时刻
   node storyboard.cjs --plan         # 只打印预估时间轴，不开浏览器
   ~~~
   `storyboard.cjs` 会按旁白字数**预估**每段时长并注入动画，所以分镜里的场景边界和最终成片基本一致（`cps` 参数控制预估语速，默认 4.5 字/秒；真实时长以 TTS 实测为准）。
4. **交付审核**：把 `work/storyboard/*.png` 和 `animation.html` 一起给对方。

### 审核清单（逐条确认）

- 每段的画面是否说清了那句旁白的重点？有没有"旁白在说 A、画面在演 B"。
- 画面上的术语写法是否与旁白念法完全一致。
- 有没有文字出界、元素重叠、被面板切掉。
- 节奏：某段是否明显过长/过短（看 `--plan` 的时长比例；一般来说单段 4–12 秒比较舒服）。
- 场景数是否需要增删；顺序是否需要调整。
- 动态本身是否成立：轨迹在长、矢量在变、曲线在绘制，而不是一堆静止元素。

## 阶段二：审核通过后出片

~~~bash
node storyboard.cjs            # 改完画面再抽一次，确认无回归
node build.mjs --approved      # 没有 --approved 会被闸门拦住
node build.mjs --approved --reuse-tts   # 只动了画面时：复用已有语音，跳过 TTS
node build.mjs --approved --keep-frames # 想复查每一帧时，保留 work/frames/
~~~

### 出片校验清单

- `ffprobe` 确认两路流（h264 + aac）、`30/1` 帧率、时长与 `work/timeline.json` 一致。
- 从成品抽三帧，确认落在预期场景：
  ~~~bash
  ffmpeg -ss 6  -i out/video.mp4 -frames:v 1 f6.png
  ffmpeg -ss 20 -i out/video.mp4 -frames:v 1 f20.png
  ~~~
- 音量：`-af volumedetect` 的 `max_volume` 不高于 −1 dB（防爆音），`mean_volume` 约 −22 ~ −18 dB。
- 术语一致：旁白念的写法必须和画面上的写法一致。

## 音画同步规则（核心）

每段画面时长不是拍脑袋定的，而是由旁白决定：

~~~text
segDur_i = max(minDur, lead + 语音时长_i + tail)
start_i  = segDur_0 + ... + segDur_{i-1}
~~~

`lead`（默认 0.35s）让旁白稍晚于画面出现，`tail`（默认 0.6s）留出呼吸感。音频侧对每段做 `adelay=lead|lead, apad -t segDur_i` 补齐到与画面等长，再首尾相接；于是音轨总长 == 视频总长，且每句旁白都从对应画面段开头开始。**永远不要手工改这些时间数字**——改文案，或改 `lead`/`tail`。阶段一用同一套公式 + 预估语速，所以预审时看到的节奏就是成片节奏。

## 画面设计规范

- 每段一个主题、一句话结论；旁白说什么，画面就画什么。
- 关键量用**动态**表达：轨迹逐点生长、矢量箭头随速度变化、曲线随时间绘制、卡片错峰入场。
- **纯白底是默认**：白底 + 深墨字 + 单一强调色。白底投屏、打印、混排进 PPT/文档都不挑环境。
  色板（直接用这套，别自创）：底 `#ffffff` · 网格 `rgba(100,116,139,0.10)` · 主墨 `#0f172a` · 次墨 `#334155` · 弱文本 `#64748b` · 强调蓝 `#2563eb`（浅 `#60a5fa` / 深 `#1d4ed8`）· 暖橙 `#f97316` · 琥珀 `#f59e0b` · 绿 `#16a34a` · 红 `#dc2626`。
  卡片 = 白底 `rgba(255,255,255,0.95)` + 细描边 `rgba(15,23,42,0.12)` + 柔和投影 `rgba(15,23,42,0.10)`，圆角 18。
- **白底上不要加径向色晕/光斑**：近白区间会出现肉眼可见的色块边界（PNG 体积也会暴涨）。要层次就用网格和卡片。
- **物理量和公式一律用 LaTeX 排版（KaTeX），禁止在 canvas 上拼字符**：`y = 1/2 g t^2`、`T = 2 pi sqrt(m/k)` 这类写法一律不要。真分数、带横线的根号、上下标、希腊字母全部交给 KaTeX。
  写法：`math({ id, seg, tex, size, color, place })`；`tex` 直接写 LaTeX（JS 字符串里反斜杠要双写，例如 `'y = \\frac{1}{2} g t^2'`、`'T = 2\\pi\\sqrt{\\dfrac{m}{k}}'`、`'F = \\dfrac{m v^2}{r}'`），`place(lt, dur)` 每帧返回 `{ x, y, a }`，位置可以跟着运动矢量走。
- 中文标题与说明文字**留在 canvas 上**（KaTeX 字体不含中文字形，中文写进 tex 会掉到 fallback 字体）。
- 公式层是 canvas 之上的 `#math` 层，会一起被截图；KaTeX 放在项目 `vendor/katex/`，字体已 base64 内联进 CSS，离线可用、`file://` 下没有字体 CORS 问题。两个截图工具都会等 `document.fonts.ready` 再拍。
- 中文用 `"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif`；公式用等宽字体。
- 场景切换用 0.4–0.6s 交叉淡入：先画上一场景的终态，再用 `ctx.globalAlpha` 叠加当前场景。
- 底部常驻一条 3px 进度条，观众知道还剩多久。
- **每帧只依赖 `t`**（纯函数式绘制），不要用累积状态或 `Math.random()`，否则逐帧定格会漂移、分镜与成片不一致。

## 在 DSH 插件包里用时（可选）

如果这个 skill 由 DSH 的 `dsh-h5-animation` 插件包挂载，会话里会多一个 `h5video` 原生工具，覆盖同样的确定性步骤：

~~~text
h5video check-env --json           环境体检（ffmpeg / ffprobe / say / Chromium）
h5video scaffold <目录>             生成项目骨架（不覆盖已有文件）
h5video plan <项目>                 只打印预估时间轴
h5video storyboard <项目>           阶段一：出分镜图，交人审核
h5video build <项目> --approved     阶段二：出片
h5video probe <成品.mp4>            出片校验（ffprobe JSON）
h5video voices                     say 音色列表
~~~

没有插件时用 bash 里的 `node storyboard.cjs` / `node build.mjs`，两者等价，`--approved` 闸门相同；
工具找不到 node / ffmpeg 时会明确报错，这时直接用 bash 即可。

## 平台支持

| 平台 | 录制 / 编码 / 混流 | 旁白（TTS） | 静态工具 |
| --- | --- | --- | --- |
| macOS | 可用 | `say`（内置） | `tools/install-tools.sh` |
| Linux | 可用 | 无 `say`：外部 TTS 预生成 `work/segN.aiff` → `build.mjs --approved --reuse-tts` | `tools/install-tools.sh` |
| Windows | 可用 | 同上；可用 PowerShell 的 `System.Speech` | `tools\install-tools.ps1` |

- **二进制架构必须与本机匹配**：arm64 机器上跑到 x86_64 的 ffprobe 会报 `Bad CPU type in executable`。两个 install 脚本都会真的跑一次 `-version` 自检，坏的重下；插件会话里用 `h5video check-env` 看候选清单与不可用原因。
- **没有 `say` 的平台**：`build.mjs` 的第一步仍会调 `say`，所以要先自己按 `script.json` 的段序生成 `work/segN.aiff`，再加 `--reuse-tts` 跳过 TTS；时长仍由 ffprobe 实测，音画同步公式不变。PowerShell 例子与细节见 [references/pipeline.md](references/pipeline.md) 第 9.4 节。

## 常见故障

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `build.mjs` 打印"尚未审核通过"并 exit 2 | 审核闸门 | 先走阶段一，确认后加 `--approved` |
| 分镜看起来和成片对不上 | 分镜用的是预估时长 | 属正常，差异通常在 ±1 秒内；以 `--approved` 后的 `timeline.json` 为准 |
| `Executable doesn't exist ... chromium_headless_shell-####` | require 到了未安装对应浏览器的 playwright-core | 两个脚本都会逐个尝试候选版本，看到"跳过"属正常 |
| 编码报 Unknown encoder 'libx264' | 用了 Playwright 自带的 ffmpeg-mac（只有 VP8/WebM） | 换 tools/ffmpeg 静态版 |
| adelay / apad 过滤器不存在 | 同上 | 同上 |
| `Bad CPU type in executable`（ffmpeg/ffprobe 起不来） | 二进制架构与机器不匹配（arm64 机器上是 x86_64 的 ffprobe，又没装 Rosetta） | 重跑 `tools/install-tools.sh`（会按架构重下并自检），或 `brew install ffmpeg`；插件会话里 `h5video check-env` 会报出哪个候选不可用 |
| say 没有声音 | 音色名不对 | `say -v '?'` 列出全部音色，填进 script.json 的 voice |
| 逐帧结果抖动、不一致 | 绘制里用了随机数或累积状态 | 改成由 t 派生的确定性伪随机 |
| 写文件被沙箱拒绝 | 在会话工作区之外操作 | 把项目建在工作区内，或申请更宽权限 |

## 参考文件

- [references/pipeline.md](references/pipeline.md)：环境依赖与安装命令、script.json 字段表、时间轴格式、编码参数、故障排查、在 DSH 中注册为 skill 或插件包的方法。
- [references/scene-cookbook.md](references/scene-cookbook.md)：可直接复制的绘制片段（背景、面板、矢量箭头、轨迹、波形、圆周、卡片、进度条、交叉淡入）。
- [templates/](templates)：项目骨架（animation.html / storyboard.cjs / build.mjs / script.json / setup.sh）。
- [examples/物理动态演示/](examples/物理动态演示)：成品样例，含 MP4、旁白文案、时间轴、分镜帧与审核用的抽帧。
- [packages/dsh-h5-animation/](packages/dsh-h5-animation)：DSH 插件包（bundle + 「H5 动画视频」preset + `h5video` 工具）。
