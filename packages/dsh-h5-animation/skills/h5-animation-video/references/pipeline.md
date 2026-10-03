# 流水线细节

## 1. 环境探测

先确认这几样东西在不在，缺什么补什么：

~~~bash
which say node                          # macOS 语音合成 / Node 18+
ls ~/Library/Caches/ms-playwright | grep chromium   # 无头浏览器
node -e "require.resolve('playwright-core')"        # 浏览器驱动
./tools/ffmpeg -encoders | grep -E "libx264| aac "  # MP4 编码能力
~~~

关键结论（本机实测）：

- Playwright 自带的 `ffmpeg-mac` 是**阉割版**：只有 libvpx_vp8 / webm，没有 libx264、没有 aac，连 adelay/apad 过滤器都没有，**出不了 MP4**。必须另配一个全功能 ffmpeg。
- `playwright-core` 可以从任何已安装它的项目里 require：`createRequire(import.meta.url)` 后 `require('<绝对路径>/playwright-core')`。build.mjs 用环境变量 `PW_CORE` 覆盖。
- **一台机器上常并存多个 playwright-core**，每个版本要求的 Chromium 修订号不同。若 require 到的是较新版本而对应 Chromium 没装，就会报
  `Executable doesn't exist at .../chromium_headless_shell-1243/...`。
  模板里的做法是：列出全部候选（env → require.resolve → 项目 node_modules → 已安装的 .pnpm 目录），**逐个试着启动**，用第一台真能跑起来的，并打印实际用的是哪一个。所以这类报错不会让流程中断，只会多一行"跳过"。
- macOS 的 `say` 自带中文音色，`say -v '?'` 可列出；本样例用 `Tingting`。

## 2. 安装静态 ffmpeg / ffprobe

**方式 A：直接下载（推荐，绕开 npm 的 postinstall）**

~~~bash
mkdir -p tools && cd tools
curl -L -o ffmpeg.gz https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz
gunzip -f ffmpeg.gz && chmod +x ffmpeg
cp /path/to/ffprobe-static/bin/darwin/arm64/ffprobe .
./ffmpeg -version | head -1
~~~

**方式 B：npm**

~~~bash
npm i ffmpeg-static ffprobe-static --cache "$PWD/.npm-cache"
~~~

两个坑：

- 全局 npm 缓存若被 root 占过（EPERM），用 `--cache` 指到项目内即可。
- `ffmpeg-static` 的二进制是在 postinstall 里从 GitHub 下载的，网络慢时会挂住；这时直接改用方式 A 下载同一版本的 `.gz`。

**方式 C：Homebrew**（若 shell 跑在 Rosetta 下要用 `arch -arm64` 调用）

~~~bash
arch -arm64 /opt/homebrew/bin/brew install ffmpeg
~~~

## 3. script.json 字段

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| fps | 30 | 帧率，同时决定录制步长 |
| width / height | 1280 / 720 | 画布与视口尺寸，必须与 animation.html 的 canvas 一致 |
| voice | Tingting | `say` 音色；`say -v '?'` 查全部 |
| rate | 178 | 语速。中文约 4–5 字/秒；调大更快 |
| cps | 4.5 | 预估语速（字/秒），**只用于阶段一出分镜时的时长预估**；成片时长以 TTS 实测为准 |
| lead | 0.35 | 每段画面开头留白，旁白晚于画面出现（秒） |
| tail | 0.6 | 每段画面结尾留白，给观众喘息（秒） |
| minDur | 2.4 | 单段最短时长，防止短句一闪而过 |
| output | video.mp4 | 输出文件名，落在 out/ 下 |
| segments[].id | — | 必须等于 animation.html 里 SCENES 的键 |
| segments[].text | — | 旁白文本，一段一句 |

## 4. animation.html 接口契约

页面必须暴露三样东西，构建脚本靠它们驱动：

~~~js
window.__VM = { fps: 30, segments: [{ id: 'title', start: 0, dur: 5 }, ...] };  // 由 addInitScript 注入
window.__seek = function (t) { /* 把画面确定性渲染到第 t 秒，并停掉 rAF */ };
window.__ready = true;                                                          // 渲染函数就绪
~~~

约定：

- `__seek` 必须是幂等的纯渲染：给定 t，输出永远一样。不要依赖上一次的状态。
- 未被注入 `__VM` 时（直接用浏览器打开）用内置的默认时间轴 + requestAnimationFrame 自动播放，方便预览。
- 场景切换的交叉淡入写在 `render(t)` 里：找到当前场景，若处于该场景前 0.5s，先画上一场景终态，再用 `ctx.globalAlpha = lt/0.5` 叠当前场景。
- 页面分两层：`<canvas>` 画图形，`#math` 层放 KaTeX 渲染的公式。公式位置由 `place(lt, dur)` 每帧同步，所以能挂在运动的矢量上（样例里的 `v_x`、`F`、`m` 都跟着箭头/滑块走）。物理量一律用 LaTeX，不要在 canvas 上拼 `^2`、`sqrt()`。
- **截图前必须等字体就绪**：storyboard.cjs 与 build.mjs 都会 `await page.evaluate(() => document.fonts.ready)`，否则首帧可能落在 fallback 字体上。
- KaTeX 放在项目 `vendor/katex/`（`katex.min.js` + `katex-inline.css`，woff2 已 base64 内联，约 0.35MB）：完全离线，`file://` 下没有字体 CORS 问题。重做这份 CSS 的办法见 [scene-cookbook.md](scene-cookbook.md) 第 11 节。

## 5. storyboard.cjs（阶段一：审核）

**出片之前必须跑它**，把画面交人确认：

~~~bash
node storyboard.cjs                # 每场景自动抽 2 帧（25% / 75% 处）-> work/storyboard/
node storyboard.cjs --shots 3      # 每场景抽 3 帧
node storyboard.cjs --at 2.5 9 16  # 只抽指定时刻
node storyboard.cjs --plan         # 只打印预估时间轴（不开浏览器）
~~~

它做三件事：

1. 读 `script.json`，用 `cps`（字/秒）**预估**每段语音时长，套用与 build.mjs 完全相同的公式算出预估时间轴，打印成表格（含每段占比与总帧数）。
2. 把这条预估时间轴通过 `addInitScript` 注入页面，所以分镜里的场景边界与最终成片基本一致（差异通常 ±1 秒内）。
3. 渲染分镜 PNG 到 `work/storyboard/`，命名 `场景NN_<id>_<秒>s.png`。

审核时把**分镜图**和 **animation.html**（浏览器打开即自动播放）一起交给对方。收到明确同意后再进阶段二。

## 6. build.mjs 每步在做什么（阶段二）

**闸门**：没有 `--approved` 会打印提示并 `exit 2`。这是刻意设计的——画面未经人工确认就不该花算力编码。

1. **TTS**：`say -v Tingting -r 178 -o work/segN.aiff "<文本>"`。
2. **量时长**：`ffprobe -show_entries format=duration -of default=nw=1:nk=1`（比正则解析 `ffmpeg -i` 的 stderr 稳）。
3. **算时间轴**：`segDur = max(minDur, lead + audioDur + tail)`，累加得到每段 start 与总时长，总帧数 = `round(total * fps)`。
4. **补齐音频**：

   ~~~bash
   ffmpeg -y -i work/segN.aiff -af "adelay=350|350,apad" -t <segDur> \
          -ar 44100 -ac 2 -c:a pcm_s16le work/segN.wav
   ~~~

   `adelay` 前补 lead 秒静音，`apad` 无限补尾、由 `-t` 精确截断到 segDur。
5. **拼接音轨**：`ffmpeg -f concat -safe 0 -i audio-list.txt -c copy work/narration.wav`。
6. **逐帧录制**：

   ~~~js
   await page.addInitScript(tl => { window.__VM = tl; }, timeline);
   await page.goto('file://' + project + '/animation.html');
   await page.waitForFunction('window.__ready === true');
   for (let f = 0; f < totalFrames; f++) {
     await page.evaluate(t => window.__seek(t), f / fps);
     await page.screenshot({ path: 'work/frames/' + pad5(f) + '.jpg', type: 'jpeg', quality: 95 });
   }
   ~~~
7. **编码 + 混流**：

   ~~~bash
   ffmpeg -y -framerate 30 -start_number 0 -i work/frames/%05d.jpg \
          -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart work/video.mp4
   ffmpeg -y -i work/video.mp4 -i work/narration.wav \
          -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out/video.mp4
   ~~~

## 7. 产物格式

`work/timeline.json` 是唯一的"时间真相"，出问题先看它：

~~~json
{
  "fps": 30,
  "segments": [{ "id": "title", "start": 0, "dur": 4.0137 }],
  "total": 42.0248,
  "totalFrames": 1261,
  "output": ".../out/video.mp4"
}
~~~

## 8. 性能与体积

本机实测（M 系列，1261 帧 42 秒）：

| 阶段 | 耗时 |
| --- | --- |
| TTS + 量时长 | ~4s |
| 逐帧录制 | 42s（约 30ms/帧） |
| H.264 编码 | ~3s |
| 混流 | ~1s |
| 成品体积 | 2.7 MB（CRF 18，纯白底） |

- 中间帧用 **JPEG q95** 可以把磁盘占用从 ~600MB（PNG）降到 ~150MB，画质在 yuv420p 之后肉眼无差；要绝对无损就把 build.mjs 里的 `.jpg` 改回 `.png`。
- build.mjs 每次运行会先清空 `work/frames/`；出片成功后默认再删掉它（上千张 JPEG 约 100MB+），要复查就加 `--keep-frames`。
- 想更小：`-crf 23`；想更清晰：`-crf 15 -preset slow`。
- **白底比深色底省一半以上码率**：同一段动画深色底 6.8 MB、纯白底 2.7 MB（同样 CRF 18、1261 帧）。大面积平滑区域更容易压缩。

## 9. 在 DSH 中使用

### 9.1 插件包（推荐：可随时插拔）

`packages/dsh-h5-animation/` 是一个自包含的 DSH 组合包（bundle）：挂载随包 skill、注册 `h5video` 确定性工具，
并声明「H5 动画视频」agent preset（id `h5-animation`）。

- 安装：侧栏「插件」页按本地路径安装 `packages/dsh-h5-animation`；或在 creator 模式会话里用
  `plugin_manager` 的 `install_bundle`，target 传该目录的绝对路径。
- 选 preset：**新开**会话里选「H5 动画视频」（或在「设置 → 通用」设为默认）。
- 摘掉：在「插件」页停用 / 卸载，或在 profile patch 里把行 `preset-h5-animation` 置 `disabled: true`。

插件里的确定性入口（与 bash 脚本等价，`--approved` 闸门相同）：

~~~bash
h5video check-env --json            # 环境体检（ffmpeg / ffprobe / say / Chromium / skill 布局）
h5video scaffold <目录>              # 从随包 templates 生成项目骨架，不覆盖已有文件
h5video plan <项目>                  # 只打印预估时间轴
h5video storyboard <项目>            # 阶段一：出分镜图，交人审核
h5video build <项目> --approved      # 阶段二：出片（没有 --approved 由脚本 exit 2 拦下）
h5video probe <成品.mp4>             # 出片校验：ffprobe JSON，看 h264 + aac 两路流
h5video voices                     # say 音色列表（默认只看中文）
~~~

随包 skill 是仓库源文件的**同步副本**（`node packages/dsh-h5-animation/scripts/sync-skill.mjs` 生成、
`--check` 校验，`node --test` 里有契约测试守一致性）：改了本仓库的 SKILL.md / references / templates / examples，
记得同步一次副本，否则 preset 会话里读到的是旧内容。静态 ffmpeg / ffprobe **不随包**（100MB+），
按 9.3 在项目里获取；`h5video check-env` 会逐个候选实测能否运行。

### 9.2 只注册 skill

DSH 从两处扫描 skill：会话工作区的 `.dsh/skills/<name>/SKILL.md`，以及全局的 `~/.dsh/skills/<name>/SKILL.md`。

~~~bash
# 全局注册（任何项目都能用）
ln -s "/Users/chouchou/开发/h5动画演示" ~/.dsh/skills/h5-animation-video

# 或只给某个项目用
ln -s "/Users/chouchou/开发/h5动画演示" "<项目>/.dsh/skills/h5-animation-video"
~~~

注册后新开会话，`h5-animation-video` 会出现在 skill 目录里。

### 9.3 获取 ffmpeg / ffprobe（按平台）

| 平台 | 命令 | 来源 |
| --- | --- | --- |
| macOS / Linux | `cd "<项目>" && ./tools/install-tools.sh` | ffmpeg：macOS 用 eugeneware/ffmpeg-static 的 release，Linux 用 johnvansickle 静态包；ffprobe：macOS arm64 用 `@ffprobe-installer/darwin-arm64`（退路 osxexperts），macOS x64 用 evermeet.cx |
| Windows | `powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1` | gyan.dev 的 release-essentials 包（内含 `ffmpeg.exe` 与 `ffprobe.exe`） |
| 任意平台 | `brew install ffmpeg` / `winget install Gyan.FFmpeg` / 发行版包管理器 | 交给系统包管理器，PATH 上就能找到 |

或者用 npm（两个脚本与 `h5video` 都会按顺序找 `node_modules`）：

~~~bash
npm i ffmpeg-static ffprobe-static                  # Intel Mac / Linux
npm i @ffprobe-installer/darwin-arm64               # Apple Silicon 的 ffprobe（ffprobe-static 在 macOS 上只有 x86_64）
~~~

两个 install 脚本都会**实际跑一次 `-version`** 判断可用性——只检查文件存在是不够的：
arm64 机器上 x86_64 的 ffprobe 也是「可执行」的，一跑就 `Bad CPU type in executable`，
旧版脚本因此会一直跳过它，把问题留给最贵的出片环节。`h5video check-env` 按同样的顺序逐个实测候选
（`env FFMPEG/FFPROBE` → `H5VIDEO_TOOLS_DIR` → 项目 `tools/` → `node_modules/{ffmpeg,ffprobe}-static`
→ `node_modules/@<name>-installer/<platform>-<arch>` → PATH），只把真正能跑的算作可用，并按 `origin` 报告用了哪一个。

curl / npm 报 `certificate has expired` 时，先确认系统时钟是否准（时钟跑到未来会让所有证书看起来过期）；
报 `self signed certificate` 说明网络里有 TLS 拦截代理，可临时 `H5_INSECURE_TLS=1 ./tools/install-tools.sh`
（只在信任当前代理时用，脚本会打印警告），或者干脆换系统包管理器。

### 9.4 平台支持与没有 `say` 的机器

逐帧录制、编码、混流三件事只要有 Node + Chromium + ffmpeg/ffprobe 就能跑，三个平台都行；
但**旁白合成用的是 macOS 的 `say`**，Linux / Windows 没有它。

没有 `say` 时的做法：先把每段旁白做成音频放在 `work/segN.aiff`（N 从 0 开始，顺序与 `script.json`
的 `segments` 一致），再用 `--reuse-tts` 让 `build.mjs` 跳过 TTS：

~~~bash
node build.mjs --approved --reuse-tts
~~~

`build.mjs` 只会用 ffprobe 量这些文件的真实时长，后面的 `segDur = max(minDur, lead + 语音 + tail)`
与混流完全不变。Windows 上用系统语音生成（PowerShell）：

~~~powershell
$cfg = Get-Content script.json -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path work | Out-Null
Add-Type -AssemblyName System.Speech
$tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
# 中文音色按机器安装情况选：$tts.GetInstalledVoices() | % { $_.VoiceInfo.Name }
$i = 0
foreach ($seg in $cfg.segments) {
  $tts.SetOutputToWaveFile((Join-Path work "seg$i.aiff"))
  $tts.Speak($seg.text)
  $i++
}
$tts.Dispose()
node build.mjs --approved --reuse-tts
~~~

文件名沿用 `.aiff` 只是历史约定：ffmpeg 按内容识别格式，写成 WAVE 也能读。
这条 Windows 路径尚未在真机验证过，第一次跑请照 SKILL.md 的「出片校验清单」逐项核对。

## 10. 故障排查（扩展）

| 症状 | 判断 | 处理 |
| --- | --- | --- |
| `build.mjs` 打印"尚未审核通过"并 exit 2 | 审核闸门（预期行为） | 先 `node storyboard.cjs` 交审，确认后加 `--approved` |
| 分镜的场景边界与成片略有出入 | 分镜用的是预估时长 | 正常，差异通常 ±1s；以出片后的 `work/timeline.json` 为准 |
| `Cannot read properties of undefined (reading 'launch')` | require 到的不是 playwright 入口 | 指向 `.../playwright-core`，不要指 `.../playwright/index.js` |
| `ffmpeg: Unknown filter 'adelay'` | 用的是 Playwright 自带 ffmpeg | 换 `tools/ffmpeg` |
| 音轨比视频长/短 | 拼接时没有用 `-t segDur` 截断 | 检查第 4 步 |
| 音画错位半秒内 | lead 太小/太大 | 调 `lead`，重新 `build.mjs --approved`（不必 `--reuse-tts`） |
| 录制特别慢 | `deviceScaleFactor` 或分辨率过大 | 录制用 1x，最终清晰度靠码率 |
| `afconvert`/python 报 xcrun 架构错误 | shell 跑在 Rosetta（x86_64）下 | 用 `arch -arm64 <cmd>` 重新执行 |
| `Bad CPU type in executable`（ffmpeg/ffprobe 起不来） | 二进制架构与机器不匹配（arm64 机器上是 x86_64 的 ffprobe，又没装 Rosetta） | `h5video check-env` 看候选清单；换对应架构的静态版，或 `npm i ffprobe-static` |
| 插件包会话里 `h5video` 报找不到 node | 宿主进程的 PATH 没有 node（fnm/nvm 通常只在交互 shell 生效） | 在 profile patch 的 `h5video-tools` 行写 `nodePath: /绝对路径/bin/node`；或直接用 bash 跑脚本 |
| 视频在某些播放器无声 | AAC 采样率/声道异常 | 统一 `-ar 44100 -ac 2` |
