# 样例：物理动态演示

42 秒成品，5 个场景，中文旁白。用来对照"什么样的画面算是合格的"，也用来对照两阶段流程各自该交付什么。

公式全部是 **LaTeX 真排版**：`y = \frac{1}{2} g t^2`（真上下标与分数）、`T = 2\pi\sqrt{\dfrac{m}{k}}`（带横线的根号套分式）、`F = \dfrac{m v^2}{r}`、`v = \dfrac{2\pi r}{T}`，矢量标签 `v_x`、`v_y`、`F`、`r`、`m` 也都是 TeX 斜体数学字体，并且跟着箭头/滑块逐帧移动。

## 文件

| 文件 | 阶段 | 说明 |
| --- | --- | --- |
| animation.html | 一 | 画面本体，5 个场景：标题 / 平抛运动 / 弹簧振子 / 匀速圆周 / 三步总结。物理量与公式全部用 LaTeX 渲染 |
| vendor/katex/ | 一 | KaTeX（含内联字体的 CSS），公式排版引擎，离线可用 |
| script.json | 一 | 旁白文案与参数（Tingting、rate 178、cps 4.5、lead 0.35、tail 0.6） |
| storyboard/场景*.png | 一 | 交给审核的分镜图，命名 `场景NN_<id>_<秒>s.png`（由 storyboard.cjs 生成） |
| timeline.json | 二 | 出片后的真实时间轴（每段 start/dur、总帧数 1261） |
| out/物理动态演示.mp4 | 二 | 成品：1280x720 / 30fps / H.264 + AAC / 42.03s / 2.7 MB（纯白底） |
| storyboard/成品抽帧_*.png | 二 | 从成品 MP4 里抽的帧，用于验证音画对齐 |

## 复现

~~~bash
cd 物理动态演示
mkdir -p tools && ln -sf ../../tools/ffmpeg tools/ffmpeg && ln -sf ../../tools/ffprobe tools/ffprobe
node ../../templates/storyboard.cjs                      # 阶段一：出分镜
node ../../templates/build.mjs --approved                # 阶段二：出片
~~~

## 这个样例做对了几件事

- 旁白念什么，画面就画什么：说"水平匀速、竖直自由落体"，画面就同时给出等时间幽灵点、vx 恒定箭头、vy 增长箭头。
- 抽象量都有可视化：位移用振动块 + 实时绘制的 x-t 曲线；向心力用指向圆心的红色箭头。
- 每个场景右侧固定一块公式面板，术语写法与旁白完全一致。
- 底部常驻进度条；场景之间 0.5s 交叉淡入；背景光斑缓慢漂移，画面不"死"。
