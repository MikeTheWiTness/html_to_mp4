---
name: h5-animation-video
description: Produce a narrated MP4 from a self-contained HTML/CSS/Canvas animation through three gated stages — first write a detailed design document and get approval, then build the reviewable HTML plus storyboard and get sign-off, and only then synthesize Chinese narration, render deterministic frames and encode H.264 + AAC. Use when asked to make a 演示视频 / 动画视频 / 课件视频 / 宣传短片 from HTML, to add 旁白/配音 to an H5 animation, or to export an interactive HTML demo as MP4 for class, PPT, WeChat or social sharing.
---

# H5 动画 → MP4（含旁白）

把一段网页动画变成可播放的视频，画面、公式与旁白天然同步。先审设计，再审 HTML，最后出片；全程离线，不依赖云 TTS。

## 阶段零：环境自检（开工前先做，缺件先问用户要不要装）

不要等做到一半才失败。**任何操作之前**先跑自检，把缺件如实报告给用户并征得同意再安装：

```bash
h5video doctor              # 人类可读：✓ 可用 / ✗ blocking / ⚠ 可降级，每项都带修复命令
h5video doctor --json       # 结构化：ready / blocking[] / degradable[] / checks[]
h5video doctor --fix        # 只打印将要执行的安装命令，不改动任何东西（退 3）
h5video doctor --fix --yes  # 真的下载安装，装完自动复检
```

- **blocking（缺了出不了片）**：ffmpeg、ffprobe、Chromium + 匹配的 playwright-core、随包 skill 文件、Node 18+、工作区可写。
- **degradable（缺了能降级）**：没有 compact 中文音色 → 无声片或 `--reuse-tts`；没有中文字体 → 中文变方框；磁盘不足 → 录制中途可能失败。
- **拿到报告后必须做的**：把 blocking 项转述清楚（缺什么、为什么必须、要下多少 MB、是否需要联网），用提问控件征得用户同意后才 `--fix --yes`；**默认只报告、不擅自安装**。装完重跑 `doctor` 复检，并把报告留档到项目的 `work/env-report.json`。
- **内网 / 离线**：先设 `H5VIDEO_MIRROR`（扁平镜像目录，文件名约定见 `tools/install-tools.sh` 头部注释）和 `npm_config_registry`，再跑 `doctor --fix --yes`。
- **没有插件时**：手动确认 `ffmpeg -version` / `ffprobe -version` 能跑、`say -v Tingting`（macOS）或 SAPI 中文人声（Windows）在、Chromium 缓存与 playwright-core 版本一致；依赖用 `tools/install-tools.sh` / `.ps1` 装。
- **平台支持目标**：macOS 与 Windows；**Linux 不保证**（无本地中文 TTS、字体需自备，只能外部音频 + `--reuse-tts`）。

## 铁律：先确认设计，再生成 HTML，最后出片

整个流程分为三个有明确人工确认闸门的阶段，不得合并或跳过：

| 阶段 | 产出 | 确认点 |
| --- | --- | --- |
| 一 · 设计 | `design.md`（详细设计方案） | 用户明确确认方案后，才开始制作 HTML |
| 二 · HTML | `animation.html` + 分镜图 + 旁白稿 + 预估时间轴 | 用户审核 HTML/分镜/语音并明确确认后，才生成 MP4 |
| 三 · 出片 | `out/*.mp4`（H.264 + AAC + 旁白） | 使用 `node build.mjs --approved` |

- 阶段一先交 `design.md`，此时不要创建/生成最终 `animation.html`，不要调用 storyboard 或 build。方案未获用户明确确认前，只能根据反馈修改方案并重新交审。
- 设计方案确认后才进入 HTML 阶段；HTML 阶段的确认不能反向代替设计方案确认。
- HTML/分镜/语音审核通过之前，不要运行 `build.mjs`。其 `--approved` 闸门仍必须遵守，不得绕过。
- 阶段一设计文档至少写清：教学目标与课程范围、必要前置知识和明确排除的超纲内容、教学逻辑与逐场景顺序、每场景画面/运动方式/旁白要点/预计时长、如何逐一呈现多种情况及是否需要末尾比较、交互/播放行为、输出规格与待确认假设。
- 默认文件名为项目目录下的 `design.md`；也可按项目命名为 `设计方案.md`，但交付时必须给出明确可读的文档链接。
- 设计确认后若实现中发现必须变更教学范围、场景顺序或核心表现方式，应先更新方案并再次取得确认，再继续实现。
- HTML 阶段必须同时交付分镜 PNG 和 `animation.html` 本体，用户可以检查动态效果与语音；审核意见只在方案已确认的范围内实施，否则先回到设计确认。

## 课程内容与演示节奏（物理课件必守）

面向同步课程的高中物理演示，按课程标准和教材当前教学顺序讲解，不把后续章节的应用提前塞进当前概念。动笔前先明确本节课的知识点、必要前置知识和本节结论；每一段只服务于这些目标。除非用户明确要求拓展，禁止用尚未学习的模型或情境“丰富”演示。比如“运动的描述 / 参考系”只讲参考系的含义、选取参考系后运动描述如何变化及必要的相对运动关系，不引入平抛运动、运动合成等后续知识。

- 按教学顺序组织：问题情境 → 概念/观察对象 → 逐个建立观察视角 → 本节结论；不按视觉效果堆砌内容。
- 默认一次只演示一种情况。不同观察者/参考系使用独立、连续的场景，先完整演示地面视角，再完整演示车厢视角；不要在整个主体过程中同时开多个动态视频窗口。
- 只有在各情况分别讲清后，且确有助于比较时，才在结尾短暂并列或同步对比；比较画面不是主体演示的替代品。
- 动画和 HTML 预览播放一遍后停在结尾，不循环、不自动重播。可保留明确的手动重播/进度控制。
- 旁白与场景逐段对应，先讲当前观察对象和现象，再给本节结论；不得借旁白引入超纲结论。

## 阶段二旁白要求

旁白不是阶段三才添加的附件。第二阶段就要在 `animation.html` 预览中提供逐段讲解语音，默认使用当前可用的中文音色，并为每段旁白提供与对应场景一致的开始/结束时机。浏览器预览可用 Web Speech API（`speechSynthesis`，优先选择 `lang` 为 `zh-CN`/`zh` 的默认系统音色）；应提供明确的播放/重播控件，按 `script.json` 顺序逐段朗读，并在讲解结束后停止。页面不得要求用户去另开终端或外部播放器才能听到审核旁白。浏览器有自动播放限制时，由用户点击播放启动；分镜仍可静音截图。

HTML 预览使用浏览器可用的默认中文语音时，要将它标明为预览音色；最终 MP4 仍由 `script.json` 指定的 TTS 音色合成。阶段三必须基于实际语音时长重算段时长及后续场景起点，不得沿用预估时长硬塞音频。保留 `script.json`、分段音频素材和 `work/timeline.json`，使审核、换音色和重出片能追溯到同一套分段文案。

**后续换音色**：技术上可以把 MP4 中的音轨替换掉（ffmpeg 可保留视频流并重新封装音频流），但只适合新旧旁白总时长、分段停顿和语句起点基本一致的情况。不同音色/语速通常会改变每句时长，直接替轨会造成画面与讲解错位，或被截断/补静音。标准做法是用保留的分段文案重新合成新音色，测量每段实际时长，重算 `timeline.json`，重新渲染时间轴并重混 MP4；若只换音频而无需改画面，也至少按新时间轴重建/调整视频时长后再封装。不要把“可替换音轨”描述成任意音色都能无损一键替换。

## 何时用

- 要把 HTML/CSS/Canvas/SVG 动画导出成可播放、可分享的视频（课堂讲解、微课、宣传短片、PPT 插片）。
- 要给已有的 H5 演示加中文旁白。
- 需要稳定可复现的渲染结果：逐帧定格，不掉帧，与机器性能无关。

**不适用**：真人出镜/录屏、需要摄像头麦克风的场景、必须实时交互（点击、拖拽、滚动）才能展示的内容。交互内容请先改写成自动播放的时间轴动画，再走本流程。

## 目录约定

~~~text
<项目>/
├── design.md             阶段一：详细教学/分镜/旁白设计方案，用户确认后才生成 HTML
├── animation.html       画面本体；暴露 window.__seek(t) 与 window.__VM，可独立用浏览器打开
├── vendor/katex/        KaTeX（LaTeX 公式渲染；字体已内联进 CSS，离线可用）
├── script.json          旁白文案与参数（音色/语速/留白/帧率/分辨率/输出名）
├── storyboard.cjs       阶段二：按预估时间轴出分镜图，供人工审核
├── build.mjs            阶段三：TTS → 量时长 → 录制 → 编码 → 混流（需 --approved）
├── tools/               ffmpeg / ffprobe（静态二进制）与 install-tools.sh / .ps1（按平台获取）
├── qa-tts-audio.cjs     出片前体检语音：抓「丢块 / 硬切」（听感即卡顿），hardCuts 必须为 0
├── tts-win.ps1          Windows 本地合成旁白（SAPI → work/segN.aiff），配合 build --reuse-tts
├── work/
│   ├── storyboard/      分镜图（审核用）
│   ├── segN.aiff/.wav   分段旁白
│   ├── narration.wav    完整旁白轨
│   └── timeline.json    真实时间轴（出片后）
└── out/<name>.mp4       成品
~~~

用 [templates/setup.sh](templates/setup.sh) 一键生成项目骨架。完整可跑的成品样例见 [examples/物理动态演示/](examples/物理动态演示)。

## 阶段二：设计确认后产出可审核的 HTML

只有用户明确确认 `design.md` 后才进入本阶段。

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
4. **交付审核**：把 `work/storyboard/*.png`、`animation.html` 和可试听的旁白一起交给对方。明确确认后才进入阶段三。

### 审核清单（逐条确认）

- 每段的画面是否说清了那句旁白的重点？有没有"旁白在说 A、画面在演 B"。
- 画面上的术语写法是否与旁白念法完全一致。
- 有没有文字出界、元素重叠、被面板切掉。
- 节奏：某段是否明显过长/过短（看 `--plan` 的时长比例；一般来说单段 4–12 秒比较舒服）。
- 场景数是否需要增删；顺序是否需要调整。
- 动态本身是否成立：轨迹在长、矢量在变、曲线在绘制，而不是一堆静止元素。

## 阶段三：HTML 审核通过后出片

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

`lead`（默认 0.35s）让旁白稍晚于画面出现，`tail`（默认 0.6s）留出呼吸感。音频侧对每段做 `adelay=lead|lead, apad -t segDur_i` 补齐到与画面等长，再首尾相接；于是音轨总长 == 视频总长，且每句旁白都从对应画面段开头开始。**永远不要手工改这些时间数字**——改文案，或改 `lead`/`tail`。阶段二 HTML 预审用同一套公式 + 预估语速，所以预审时看到的节奏就是成片节奏。

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
h5video doctor [--json]           阶段零自检：分级缺件 + 修复命令（--fix [--yes] 才真的安装）
h5video check-env --json           轻量体检（ffmpeg / ffprobe / say / Chromium / skill 布局）
h5video scaffold <目录>             生成项目骨架（不覆盖已有文件）
h5video plan <项目>                 只打印预估时间轴
h5video storyboard <项目>           阶段二：出分镜图，交人审核
h5video build <项目> --approved     阶段三：出片
h5video probe <成品.mp4>            出片校验（ffprobe JSON）
h5video voices                     say 音色列表
~~~

没有插件时用 bash 里的 `node storyboard.cjs` / `node build.mjs`，两者等价，`--approved` 闸门相同；
工具找不到 node / ffmpeg 时会明确报错，这时直接用 bash 即可。

## 平台支持

| 平台 | 录制 / 编码 / 混流 | 旁白（TTS） | 静态工具 |
| --- | --- | --- | --- |
| macOS | 可用 | `say`，**只用 compact 音色**（`Tingting` / `Meijia`）——`say -v '?'` 里那些「X (中文（中国大陆）)」是 eloquence 类，写文件会丢块 | `tools/install-tools.sh` |
| Windows | 可用 | `powershell -ExecutionPolicy Bypass -File tts-win.ps1`（SAPI 本地合成 → `work/segN.aiff`）→ `build.mjs --approved --reuse-tts` | `tools\install-tools.ps1` |
| Linux | **不保证**（本包不覆盖） | 外部 TTS 预生成 `work/segN.aiff` → `build.mjs --approved --reuse-tts`；中文字体自备 | `tools/install-tools.sh` |

先跑 `h5video doctor`：缺什么、怎么装、要不要现在装，它都会按平台给出命令（`--fix --yes` 才真的下载）。

- **二进制架构必须与本机匹配**：arm64 机器上跑到 x86_64 的 ffprobe 会报 `Bad CPU type in executable`。两个 install 脚本都会真的跑一次 `-version` 自检，坏的重下；插件会话里用 `h5video check-env` 看候选清单与不可用原因。
- **没有 `say` 的平台**：`build.mjs` 的第一步仍会调 `say`，所以要先自己按 `script.json` 的段序生成 `work/segN.aiff`，再加 `--reuse-tts` 跳过 TTS；时长仍由 ffprobe 实测，音画同步公式不变。PowerShell 例子与细节见 [references/pipeline.md](references/pipeline.md) 第 9.4 节。

## 常见故障

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `build.mjs` 打印"尚未审核通过"并 exit 2 | HTML 审核闸门 | 先完成并确认 design.md，再审核 HTML/分镜，确认后加 `--approved` |
| 分镜看起来和成片对不上 | 分镜用的是预估时长 | 属正常，差异通常在 ±1 秒内；以 `--approved` 后的 `timeline.json` 为准 |
| `Executable doesn't exist ... chromium_headless_shell-####` | require 到了未安装对应浏览器的 playwright-core | 两个脚本都会逐个尝试候选版本，看到"跳过"属正常 |
| 成片语音一顿一顿 / 卡顿 | 用了 **eloquence 类中文音色**（`say -v '?'` 里的「Eddy/Flo/Sandy/Grandma (中文（中国大陆）)」）：写文件时每约 1.7 s 丢约 300 ms 音频块 | 换 compact 音色 `Tingting` / `Meijia`（Windows 换一个 SAPI 中文人声）；用 `node qa-tts-audio.cjs work/seg*.aiff` 复检，`hardCuts` 必须为 0 |
| `找不到 playwright-core`（或候选全被「跳过」） | 本机 `chromium-<revision>` 与能解析到的 playwright-core 版本不一致（版本号新旧不代表 revision 一致） | `h5video doctor` 会算出该装哪个版本；用 `doctor --fix --yes`，或 `npm i playwright-core@<版本> --prefix <工作区>` |
| ffprobe 起不来：`Unknown system error -86` 或 `Bad CPU type in executable` | 二进制架构与本机不符（如 arm64 机器上的 x86_64 ffprobe） | 重跑 `tools/install-tools.sh` / `.ps1`（按架构重下，并实际跑一次 `-version` 自检）；`h5video doctor` 会指出哪个候选不可用 |
| Windows 上 `build` 第一步就失败 | Windows 没有 `say` | 先 `powershell -ExecutionPolicy Bypass -File tts-win.ps1` 生成 `work/segN.aiff`，再 `build.mjs --approved --reuse-tts` |
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
