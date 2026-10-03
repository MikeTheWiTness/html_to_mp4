# 会话级宿主探针

这些步骤必须在真实 DSH 会话里执行；仓库里的 `node --test` 只覆盖打包契约与 CLI 行为，
不替代宿主验收。记录宿主版本、会话工作区、工具退出码、完整 stdout/stderr、产物路径与执行日期。

## 1. 安装与激活

1. 安装 bundle（「插件」页按本地路径，或 `plugin_manager` 的 `install_bundle`）。
2. 确认「插件」页列出 `dsh-h5-animation`，行 `preset-h5-animation` 激活；profile 的
   `dsh.profile.bundles` 与 `dependencies` 都登记了本包。
3. **新开**会话选「H5 动画视频」preset（改过 JS 模块后必须重启宿主才会加载新代际）。

## 2. skill 与工具挂载

1. 会话 skill 目录里应出现 `h5-animation-video`；加载它返回 SKILL.md 正文。
2. 调 `h5video`，`args: ["check-env", "--json"]`：
   - stdout 是完整 JSON，`skill.dir` 指向本包 `skills/h5-animation-video`；
   - `ffmpeg` / `ffprobe` 的 `path` 与 `origin` 说明找到的位置；架构不符的二进制必须
     被跳过并在 `warnings` 里说明，而不是选中后失败。
3. 打开独立工作区 A，`work_root` 应等于 A；同一宿主打开独立工作区 B，重复调用，
   `work_root` 应等于 B 且不同于 A。两次都不传 `cwd`，才能检验真实会话注入。

## 3. 两阶段流程

1. 在工作区 A 调 `args: ["scaffold", "演示项目"]`，确认生成
   `animation.html / storyboard.cjs / build.mjs / script.json / vendor/katex/ / out/ / work/`，
   且 `tools/` 下链上了可用的 ffmpeg / ffprobe；重复调用不覆盖已有文件。
2. `args: ["plan", "演示项目"]` 只打印预估时间轴，不开浏览器。
3. `args: ["storyboard", "演示项目"]` 出分镜图到 `演示项目/work/storyboard/`，
   页面无 JS 错误；把分镜图 + `animation.html` 交给需求方审核（这就是阶段一交付物）。
4. **闸门**：`args: ["build", "演示项目"]` 必须 `exitCode: 2` 且提示"尚未审核通过"。
   这条要在 preset 会话里确认 agent 不会绕过。
5. 审核通过后 `args: ["build", "演示项目", "--approved"]`：产出 `out/*.mp4`；
   终端应能看到 `say` 逐段合成、逐帧进度、编码与混流日志，`work/timeline.json` 落盘。

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
