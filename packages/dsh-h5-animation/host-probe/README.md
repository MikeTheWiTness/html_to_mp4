# 会话级宿主探针

这些步骤必须在真实 DSH 会话里执行；仓库里的 `node --test` 只覆盖打包契约与 CLI 行为，
不替代宿主验收。记录宿主版本、会话工作区、工具退出码、完整 stdout/stderr、产物路径与执行日期。

## 1. 安装与激活

1. 安装 bundle（「插件」页按本地路径，或 `plugin_manager` 的 `install_bundle`）。
2. 确认「插件」页列出 `dsh-h5-animation`，行 `preset-h5-animation` 激活；profile 的
   `dsh.profile.bundles` 与 `dependencies` 都登记了本包。
3. **新开**会话选「H5 动画视频」preset（改过 JS 模块后必须重启宿主才会加载新代际）。

## 1.5 阶段零：环境自检（新会话第一件事）

1. 调 `h5video`，`args: ["doctor", "--json"]`：
   - 返回 JSON 必须含 `schema` / `ready` / `blocking[]` / `degradable[]` / `checks[]`；
   - 每个 `blocking` 项都要带 `why`（为什么必须）与 `fix[]`（按当前平台的修复命令）；
   - `checks[].id` 至少包含 node / skill-layout / workspace / ffmpeg / ffprobe / browser / tts / cjk-font。
2. **缺件必须问用户**：模拟缺件（把 `PATH` 换成空目录跑一次），确认 agent 会把「缺什么 / 为什么必须 / 下多少 MB / 要不要联网」讲清楚
   并等用户同意，而不是直接下载。
3. `doctor --fix`（不带 `--yes`）必须退出码 3 且只打印命令；`doctor --fix --yes` 才实际安装，装完自动复检。
4. 自检通过后，`doctor` 应报出本机 compact 中文音色（macOS: Tingting/Meijia）与匹配的 playwright-core 版本。

## 1.6 Windows 手工验收（没有实机 CI，照这张表走）

| 步骤 | 命令 | 期望 |
| --- | --- | --- |
| 依赖 | `powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1 -TargetDir <工作区>\tools` | 下到 ffmpeg.exe / ffprobe.exe 并各打印一行 `-version` |
| 自检 | `h5video doctor` | `tts` 项报出 SAPI 中文人声（如 Microsoft Huihui）；缺则提示去「设置 → 时间和语言 → 语音」加 |
| 骨架 | `h5video scaffold 演示项目` | 生成 animation.html / build.mjs / storyboard.cjs / script.json / qa-tts-audio.cjs / tts-win.ps1 |
| 旁白 | `powershell -ExecutionPolicy Bypass -File 演示项目\tts-win.ps1` | 生成 `work\seg0..N.aiff`；无中文人声时给出可执行的安装提示而不是堆栈 |
| 出片 | `h5video build 演示项目 --approved --reuse-tts` | 产出 `out\*.mp4`（H.264 + AAC，旁白来自 SAPI） |
| 体检 | `node 演示项目\qa-tts-audio.cjs 演示项目\work\seg*.aiff` | 每个文件 `hardCuts: 0` |

## 2. skill 与工具挂载

1. 会话 skill 目录里应出现 `h5-animation-video`；加载它返回 SKILL.md 正文。
2. 调 `h5video`，`args: ["check-env", "--json"]`：
   - stdout 是完整 JSON，`skill.dir` 指向本包 `skills/h5-animation-video`；
   - `ffmpeg` / `ffprobe` 的 `path` 与 `origin` 说明找到的位置；架构不符的二进制必须
     被跳过并在 `warnings` 里说明，而不是选中后失败。
3. 打开独立工作区 A，`work_root` 应等于 A；同一宿主打开独立工作区 B，重复调用，
   `work_root` 应等于 B 且不同于 A。两次都不传 `cwd`，才能检验真实会话注入。

## 3. 三阶段流程

1. 在工作区 A 先编写详细 `design.md`，包含课程目标/边界、教学顺序、逐场景画面与旁白、时长及输出规格；交给需求方审阅。未获得明确确认前，不调用 `scaffold`，不创建/生成最终 HTML，不运行 storyboard/build。
2. 收到方案明确确认后，调 `args: ["scaffold", "演示项目"]`，确认生成
   `animation.html / storyboard.cjs / build.mjs / script.json / vendor/katex/ / out/ / work/`，
   且 `tools/` 下链上了可用的 ffmpeg / ffprobe；重复调用不覆盖已有文件。
3. `args: ["plan", "演示项目"]` 只打印预估时间轴，不开浏览器。
4. `args: ["storyboard", "演示项目"]` 出分镜图到 `演示项目/work/storyboard/`，
   页面无 JS 错误；把分镜图、`animation.html` 和语音预览交给需求方审核（阶段二交付物）。
5. **闸门**：HTML/分镜/语音未获明确确认前，`args: ["build", "演示项目"]` 必须 `exitCode: 2` 且提示"尚未审核通过"；preset agent 不得自行假定批准。
6. 阶段二审核通过后，调 `args: ["build", "演示项目", "--approved"]`：产出 `out/*.mp4`；终端应能看到 `say` 逐段合成、逐帧进度、编码与混流日志，`work/timeline.json` 落盘。

## 4. 出片校验（照 skill 的清单做）

1. `args: ["probe", "演示项目/out/<name>.mp4"]` → JSON 里同时有 `h264` 与 `aac` 两路流，
   `r_frame_rate` 为 `30/1`，`format.duration` 与 `work/timeline.json` 的 `total` 一致（±0.05s）。
2. 从成品抽三帧（`ffmpeg -ss 6 -i out/x.mp4 -frames:v 1 f6.png`），确认画面落在预期场景。
3. 音量：`-af volumedetect` 的 `max_volume` 不高于 −1 dB，`mean_volume` 约 −22 ~ −18 dB。
4. 术语一致：旁白念法与画面写法一致；公式是 KaTeX 真排版（真分数、带横线的根号）。

## 5. 退路与隔离

1. 同一工作区里让 agent 直接用 bash 跑 `node 演示项目/storyboard.cjs`、
   `node 演示项目/build.mjs --approved`，确认插件不可用时流程照样成立。
2. 把整个 `演示项目/` 搬到另一个工作区，重新 `plan` 与 `probe`，确认产物自包含
   （`vendor/katex/` 在场、`animation.html` 用浏览器直接打开能自动播放）。
3. 卸掉 bundle、新开一个 `ptc` preset 会话，确认 skill 与 `h5video` 都不再出现，
   全局 `~/.dsh/skills/` 的注册不受影响。
