---
name: h5-animation-video
description: Produce a narrated MP4 from a self-contained HTML/CSS/Canvas animation through three gated stages — first write a detailed design document and get approval, then build the reviewable HTML plus storyboard and get sign-off, and only then synthesize Chinese narration, render deterministic frames and encode H.264 + AAC. Use when asked to make a 演示视频 / 动画视频 / 课件视频 / 宣传短片 from HTML, to add 旁白/配音 to an H5 animation, or to export an interactive HTML demo as MP4 for class, PPT, WeChat or social sharing.
---

# H5 动画 → MP4（含旁白）

把一段网页动画变成可播放的视频，画面、公式与旁白天然同步。先审设计，再审 HTML，最后出片；旁白可用本地 TTS，或在用户配置凭据且预检通过后使用 Fish Audio 云端 TTS。

## 阶段零：环境自检（开工前先做，缺件先问用户要不要装）

任何操作之前先跑自检，把缺件如实报告给用户、**征得用户同意**再安装：

~~~bash
h5video doctor              # ✓可用 / ✗blocking / ⚠可降级，每项带修复命令
h5video doctor --json       # 结构化：ready / blocking[] / degradable[] / checks[]
h5video doctor --fix        # 只打印将执行的安装命令，不改动任何东西（退 3）
h5video doctor --fix --yes  # 真的下载安装，装完自动复检
~~~

- **blocking**：ffmpeg、ffprobe、Chromium + 匹配的 playwright-core、随包 skill 文件、Node 18+、工作区可写。
- **degradable**：无 compact 中文音色（→ 无声片或 `--reuse-tts`）；无中文字体（→ 方框）；磁盘不足（→ 录制中途失败）。
- **拿到报告后**：把 blocking 项讲清「缺什么 / 为什么必须 / 要下多少 MB / 要不要联网」，用提问控件**征得用户同意**后才 `--fix --yes`；**默认只报告、不擅自安装**。装完重跑 `doctor` 复检，报告留档到 `work/env-report.json`。
- **内网 / 离线**：先设 `H5VIDEO_MIRROR`（扁平镜像目录，约定见 `tools/install-tools.sh` 头注释）与 `npm_config_registry`。
- 没有插件时手工确认 `ffmpeg -version` / `ffprobe -version`、`say -v Tingting`、Chromium 与 playwright-core 版本一致。细节见 [references/pipeline.md](references/pipeline.md) 第 1 节。

## 铁律：先确认设计，再生成 HTML，最后出片

三个有明确人工确认闸门的阶段，不得合并或跳过：

| 阶段 | 产出 | 确认点 |
| --- | --- | --- |
| 一 · 设计 | `design.md`（详细设计方案） | 用户明确确认方案后，才开始制作 HTML |
| 二 · HTML | `animation.html` + 分镜图 + 旁白稿 + 预估时间轴 | 用户审核 HTML/分镜/语音并明确确认后，才生成 MP4 |
| 三 · 出片 | `out/*.mp4`（H.264 + AAC + 旁白） | 使用 `node build.mjs --approved` |

- **阶段一先交 `design.md`**，此时**不要创建/生成最终 `animation.html`**，不要调用 storyboard 或 build；只能按反馈改方案并重新交审。设计文档要写清：教学目标与范围、必要前置知识和明确排除的超纲内容、逐场景顺序、每场景画面/运动/旁白要点/预计时长、多种情况如何逐一呈现、输出规格与待确认假设。
- 设计方案确认后才进入 HTML 阶段；HTML 阶段的确认不能反向代替设计方案确认。设计确认后若必须改教学范围、场景顺序或核心表现方式，先更新方案并再次取得确认。
- **HTML/分镜/语音审核通过之前不要运行 `build.mjs`**；`--approved` 闸门不得绕过。
- HTML 阶段必须同时交付分镜 PNG 和 `animation.html` 本体；审核意见只在已确认方案范围内实施，否则先回到设计确认。

## 课程内容与演示节奏（物理课件必守）

面向同步课程的高中物理，按课程标准和教材当前顺序讲解，不把后续章节提前塞进当前概念。动笔前先明确本节知识点、必要前置知识和结论，每一段只服务于这些目标；除非用户明确要求，禁止用未学的模型"丰富"演示（如"运动的描述 / 参考系"只讲参考系与运动描述的变化，不引入平抛、运动合成）。

- 按教学顺序组织：问题情境 → 概念/观察对象 → 逐个建立观察视角 → 本节结论；不按视觉效果堆砌内容。
- 默认一次只演示一种情况。不同观察者/参考系用独立、连续的场景，先完整演示地面视角，再完整演示车厢视角，主体过程中不要同时开多个动态窗口。
- 各情况分别讲清、且确有助于比较时，才在结尾短暂并列或同步对比；比较画面不是主体演示的替代品。
- 动画和 HTML 预览播放一遍后停在结尾，**不循环、不自动重播**；可保留明确的手动重播/进度控制。
- 旁白与场景逐段对应，先讲当前观察对象和现象，再给本节结论；不得借旁白引入超纲结论。

## 阶段二旁白要求

旁白不是阶段三才添加的附件。第二阶段就要在 `animation.html` 预览里提供逐段讲解语音：浏览器用 Web Speech API（`speechSynthesis`，优先 `lang` 为 `zh-CN`/`zh` 的系统音色），按 `script.json` 顺序逐段朗读、讲完停止，并用明确的播放/重播控件启动；标明这是预览音色，分镜仍可静音截图。最终 MP4 由 `script.json` 的 TTS 音色合成，阶段三必须用实测语音时长重算时间轴，不得硬塞预估时长；保留 `script.json`、分段音频与 `work/timeline.json`，让审核、换音色、重出片基于同一套文案。

## 阶段三云端旁白：Fish Audio

用户选择 Fish Audio 时，默认使用项目指定音色 ID `71d8d0bb20f04903b3114266575a1afc`，同一视频所有段落共用该 Voice ID。模型为 `s2.1-pro-free`，请求细节见 [references/pipeline.md](references/pipeline.md) 的 Fish Audio 小节。

- **批量生成前必须先做一次短句 TTS 预检**：用相同 API Key、模型、Voice ID 与请求参数生成独立 MP3，等完整响应结束，确认 HTTP 成功、音频非空且 `ffprobe` 可解码；试听确认音色后才生成各段旁白。预检失败就停止，不批量请求、不静默切换本地音色。
- API Key 只从 `FISH_AUDIO_API_KEY` 环境变量或用户指定的受保护本地配置读取；缺少凭据时先请用户配置。不得在聊天、日志、源代码或 Git 中输出/保存密钥。
- 每段旁白单独请求并保存 MP3，保持 `script.json` 顺序和一套统一旁白配置。请求正文使用清理后的文本；请求与下载完整音频的总时限为 90 秒。
- 首选 `https://api.fish.audio/v1/tts`；仅在网络连接异常时切换至 `https://47.82.118.10.sslip.io/txq/zf/in`。HTTP 错误、空音频和本地超时直接报错，不重试到中转。
- build 脚本的 `--reuse-tts` 读取 `work/segN.aiff`。保留 Fish 返回的 MP3，并逐段转成对应 AIFF 后再运行已获批准的 `node build.mjs --approved --reuse-tts`；由 build 实测段长并重算时间轴，不能沿用旧时间轴。

**后续换音色**：直接替换 MP4 音轨只适合新旧旁白总时长、停顿和语句起点基本一致的情况；音色/语速一变就会错位或被截断/补静音。标准做法是用保留文案重新合成、实测每段时长、重算 `timeline.json` 并重混；只换音频也要按新时间轴重建视频时长。不要把"可替换音轨"说成任意音色无损一键替换。

## 何时用

- 把 HTML/CSS/Canvas/SVG 动画导出成可播放、可分享的视频（课堂讲解、微课、宣传短片、PPT 插片）；给已有 H5 演示加中文旁白。
- 需要稳定可复现的渲染结果：逐帧定格，不掉帧，与机器性能无关。

**不适用**：真人出镜/录屏、需要摄像头麦克风的场景、必须实时交互（点击、拖拽、滚动）才能展示的内容——交互内容先改写成自动播放的时间轴动画，再走本流程。

## 目录约定

~~~text
<项目>/
├── design.md          阶段一：教学/分镜/旁白设计方案（用户确认后才做 HTML）
├── animation.html     画面本体；暴露 window.__seek(t)/__VM/__MATH/__SCENES
├── vendor/katex/      KaTeX（LaTeX 公式渲染；字体内联，离线可用）
├── script.json        旁白文案与参数（音色/语速/留白/帧率/分辨率/输出名）
├── storyboard.cjs     阶段二：按预估时间轴出分镜图，供人工审核
├── qa.cjs             阶段二/三：体检入口，产出 work/qa/report.json（出片闸门）
├── qa-katex.cjs       公式体检：canvas 拼字符 / tex 解析与中文 / 场景 id 对账
├── qa-frames.cjs      画面体检：抽帧查压字重叠出界缺内容与不确定性
├── build.mjs          阶段三：TTS → 量时长 → 录制 → 编码 → 混流（--approved）
├── tools/             ffmpeg / ffprobe（静态）与 install-tools.sh / .ps1
├── qa-tts-audio.cjs   语音体检：抓「丢块 / 硬切」，hardCuts 必须为 0
├── tts-win.ps1        Windows 本地合成旁白（SAPI → work/segN.aiff）
├── work/              storyboard/ 分镜 · qa/ 体检产物 · segN.aiff · timeline.json
└── out/<name>.mp4     成品
~~~

用 [templates/setup.sh](templates/setup.sh) 一键生成骨架；完整成品样例见 [examples/物理动态演示/](examples/物理动态演示)。

## 阶段二：设计确认后产出可审核的 HTML

只有用户明确确认 `design.md` 后才进入本阶段。

1. **写旁白**：编辑 `script.json` 的 `segments[].text`，每段一句；`id` 必须与 `animation.html` 里 `SCENES` 的键一致。
2. **写画面**：为每个 id 写 `sceneXxx(lt, dur)`（`lt` 是场景内秒数）并注册进 `SCENES`；绘制片段直接抄 [references/scene-cookbook.md](references/scene-cookbook.md)。画面里的物理量与公式一律用 `math({...})` 声明成 LaTeX，不要在 canvas 上拼字符。
3. **出分镜**：`node storyboard.cjs`（每场景 2 帧，25%/75%）／`--shots N`／`--at 2.5 9 16`／`--plan`（只打印预估时间轴，不开浏览器）。它按旁白字数**预估**时长并注入动画，分镜边界与成片基本一致（`cps` 控制预估语速，默认 4.5 字/秒；真实时长以 TTS 实测为准）。
4. **先自检再交人**：`node qa.cjs`（`--static` 为无浏览器版）。有 `error` 按报告改到通过，`warn` 逐条判断；见「出片前体检（qa）」。
5. **交付审核**：把 `work/storyboard/*.png`、`work/qa/flagged/*.png`（有标注时）、`animation.html` 和可试听的旁白一起交给对方，明确确认后才进入阶段三。

### 审核清单（逐条确认）

- 每段画面是否说清了那句旁白的重点；术语写法是否与旁白念法完全一致。
- 有没有文字出界、元素重叠、被面板切掉（qa-frames 已自动扫一遍，问题帧在 `work/qa/flagged/`）。
- 公式与物理量是否都走了 KaTeX、`node qa.cjs` 是否通过（canvas 上不得拼 `^2`、`sqrt()`、希腊字母）。
- 画面是否确定性：同一个 `t` 反复渲染像素一致（`nondeterministic` 必须为 0）。
- 节奏：单段是否明显过长/过短（一般 4–12 秒）；场景数/顺序是否需要调整。
- 动态本身是否成立：轨迹在长、矢量在变、曲线在绘制，而不是一堆静止元素。

## 阶段三：HTML 审核通过后出片

~~~bash
node storyboard.cjs            # 改完画面再抽一次，确认无回归
node qa.cjs                    # 出片闸门：work/qa/report.json 必须 ok
node build.mjs --approved      # 没有 --approved 会被闸门拦住
node build.mjs --approved --reuse-tts   # 只动了画面：复用已有语音，跳过 TTS
node build.mjs --approved --keep-frames # 想复查每一帧时，保留 work/frames/
node build.mjs --approved --skip-qa     # 例外：确要出未经体检的旧画面时才用
~~~

### 出片校验清单

- `ffprobe` 确认两路流（h264 + aac）、`30/1` 帧率、时长与 `work/timeline.json` 一致；从成品抽几帧确认落在预期场景。
- 音量：`-af volumedetect` 的 `max_volume` 不高于 −1 dB（防爆音），`mean_volume` 约 −22 ~ −18 dB。
- 术语一致：旁白念的写法必须和画面上的写法一致。

## 出片前体检（qa）

`node qa.cjs` 把公式与画面一起查掉，产出 `work/qa/report.json`；`build.mjs --approved` 默认**要求它存在且 ok**（否则 `exit 2`，例外用 `--skip-qa`）。三个脚本可单独运行，支持 `--strict`（warn 也算失败）与 `--json`。

- **`qa-katex.cjs`**：canvas 是否拼公式（LaTeX 命令、Unicode 上下标、`^`/`_`、`sqrt(`/`√`、希腊字母、`=` 与运算符同现）；每条 `math({ tex })` 能否解析、有无 `.katex-error`；`tex` 里是否有中文；段 id 与 `SCENES`/`math({ seg })` 是否对账；`katex` 与 `KaTeX_Main` 字体是否就绪。
- **`qa-frames.cjs`**：按预估时间轴（`--real` 用 `work/timeline.json`）抽关键帧 + 中间帧 + 交叉淡入转场帧，查文字出界/压进度条、文字互压、公式压字、公式互压/出界、空白帧、同场景墨迹骤降，以及**确定性**（同一 `t` 两次渲染像素一致、`__seek` 后画面静止，专抓 `Math.random()`/累积状态）。

产物：`work/qa/frames/`（干净抽帧，可直接交人）、`work/qa/flagged/`（红框标注）。`error` 必须修；`warn` 里 `crossfade-overlap` 多为转场设计取舍。完整判据表见 [references/pipeline.md](references/pipeline.md) 第 5.1 节。

## 音画同步规则（核心）

每段画面时长由旁白决定：`segDur_i = max(minDur, lead + 语音_i + tail)`，`start_i = Σ segDur_{<i}`。`lead`（默认 0.35s）让旁白稍晚于画面出现，`tail`（默认 0.6s）留呼吸感；音频侧 `adelay=lead|lead, apad -t segDur_i` 补齐后首尾相接，于是音轨总长 == 视频总长、每句旁白都从对应画面段开头开始。**永远不要手工改这些时间数字**——改文案，或改 `lead`/`tail`。阶段二 HTML 预审用同一套公式 + 预估语速，所以预审时看到的节奏就是成片节奏。

## 画面设计规范

- 每段一个主题、一句话结论；旁白说什么就画什么；关键量用**动态**表达（轨迹逐点生长、矢量随速度变化、曲线随时间绘制、卡片错峰入场）。
- **纯白底是默认**：白底 + 深墨字 + 单一强调色。完整色板与卡片规格见 [references/scene-cookbook.md](references/scene-cookbook.md) 第 1 节，直接用那套，别自创。
- **白底上不要加径向色晕/光斑**（近白区间会出现肉眼可见的色块边界，PNG 体积也会暴涨）；要层次就用网格和卡片。
- **物理量和公式一律用 LaTeX 排版（KaTeX），禁止在 canvas 上拼字符**：`y = 1/2 g t^2`、`T = 2 pi sqrt(m/k)` 这类写法一律不要；真分数、带横线的根号、上下标、希腊字母全部交给 KaTeX。写法与 `place()` 用法见 [references/scene-cookbook.md](references/scene-cookbook.md) 第 11 节；中文标题与说明留在 canvas 上（KaTeX 字体不含中文字形，写进 tex 会掉 fallback）。
- 中文用 `"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif`；场景切换用 0.4–0.6s 交叉淡入（先画上一场景终态，再用 `ctx.globalAlpha` 叠加当前场景）；底部常驻一条 3px 进度条。
- **每帧只依赖 `t`**（纯函数式绘制），不要用累积状态或 `Math.random()`，否则逐帧定格会漂移、分镜与成片不一致。

## 在 DSH 插件包里用时（可选）

插件包会挂一个 `h5video` 原生工具，覆盖同样的确定性步骤（与 bash 脚本等价，闸门相同）：

~~~text
h5video doctor / check-env / scaffold / plan
h5video storyboard <项目>           阶段二：出分镜图，交人审核
h5video qa <项目> [--static]        阶段二/三：公式与画面体检，产出 work/qa/report.json
h5video build <项目> --approved     阶段三：出片（默认要求 qa 通过，--skip-qa 例外）
h5video probe <成品.mp4> / voices
~~~

没有插件时用 bash 里的 `node storyboard.cjs` / `node qa.cjs` / `node build.mjs`；工具找不到 node / ffmpeg 时会明确报错，这时直接用 bash 即可。

## 平台支持

macOS / Windows 可出片；**Linux 不保证**（无本地中文 TTS、字体需自备，只能外部音频 + `--reuse-tts`）。macOS 只用 compact 音色（`Tingting` / `Meijia`）——`say -v '?'` 里那些「X (中文（中国大陆）)」是 eloquence 类，写文件会丢块。Windows 没有 `say`：先 `powershell -ExecutionPolicy Bypass -File tts-win.ps1` 生成 `work/segN.aiff`，再 `build --approved --reuse-tts`。ffmpeg / ffprobe 架构必须与本机匹配（arm64 上跑 x86_64 的 ffprobe 会 `Bad CPU type`）。完整平台差异与 PowerShell 例子见 [references/pipeline.md](references/pipeline.md) 第 9.4 节。

## 常见故障

症状 → 判断 → 处理的完整对照表见 [references/pipeline.md](references/pipeline.md) 第 10 节：审核闸门 `exit 2`、Chromium 与 playwright-core 版本不匹配、`Bad CPU type in executable`、`Unknown encoder 'libx264'` / 缺 `adelay`（用了 Playwright 自带的阉割版 ffmpeg）、语音一顿一顿（eloquence 音色；用 `node qa-tts-audio.cjs work/seg*.aiff` 复检，`hardCuts` 必须为 0）、逐帧抖动（绘制里用了随机数/累积状态）、写文件被沙箱拒绝。

## 参考文件

- [references/pipeline.md](references/pipeline.md)：环境与安装、`script.json` 字段、时间轴格式、编码参数、**qa 判据表**、平台支持、故障排查、DSH 注册方式。**按需只读相关小节**。
- [references/scene-cookbook.md](references/scene-cookbook.md)：可复制的绘制片段（背景、面板、矢量箭头、轨迹、波形、圆周、卡片、进度条、交叉淡入、LaTeX 公式层）。
- [templates/](templates)：项目骨架；[examples/物理动态演示/](examples/物理动态演示)：成品样例；[packages/dsh-h5-animation/](packages/dsh-h5-animation)：DSH 插件包与 `h5video` 工具。

