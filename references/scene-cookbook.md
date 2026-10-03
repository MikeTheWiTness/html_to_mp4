# 绘制片段手册

从 [examples/物理动态演示/animation.html](../examples/物理动态演示/animation.html) 里提炼的可复用片段。全部是普通 Canvas 2D，无第三方库。

## 0. 骨架

~~~js
var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
var MONO = 'ui-monospace,Menlo,Consolas,monospace';
var TAU = Math.PI * 2;
var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
var W = 1280, H = 720;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function ease(p) { p = clamp(p, 0, 1); return 1 - Math.pow(1 - p, 3); }   // 出场缓动
function rr(x, y, w, h, r) {                                              // 圆角矩形路径
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function text(s, x, y, font, color, align, baseline) {
  ctx.font = font; ctx.fillStyle = color;
  ctx.textAlign = align || 'left'; ctx.textBaseline = baseline || 'alphabetic';
  ctx.fillText(s, x, y);
}
~~~

## 1. 背景：纯白 + 细网格

~~~js
function bg(t) {
  ctx.fillStyle = '#ffffff';        // 纯白平铺：白底视频最稳，不会有色块边界
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(100,116,139,0.10)'; ctx.lineWidth = 1;
  for (var x = 0; x <= W; x += 64) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (var y = 0; y <= H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
}
~~~

白底视频里**不要加色块/光斑**：径向渐变在近白区间会产生肉眼可见的边界。动态感交给内容本身。

## 2. 公式面板

~~~js
function panel(x, y, w, h, a) {
  rr(x, y, w, h, 18);
  ctx.fillStyle = 'rgba(255,255,255,' + (0.95 * a) + ')'; ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,' + (0.12 * a) + ')'; ctx.lineWidth = 1.5; ctx.stroke();
}
~~~

配套的标题 + 短横线：

~~~js
panel(806, 168, 366, 360, te);
text('平抛运动', 830, 216, '700 30px ' + FONT, 'rgba(15,23,42,' + te + ')');
ctx.fillStyle = 'rgba(37,99,235,' + (0.8 * te) + ')';
ctx.fillRect(830, 230, 120, 3);
~~~

**注意**：所有淡入都用 `rgba` 的 alpha 参数，不要用 `ctx.globalAlpha`——后者被交叉淡入占用了。

## 3. 矢量箭头与虚线

~~~js
function arrow(x1, y1, x2, y2, color, width) {
  var ang = Math.atan2(y2 - y1, x2 - x1), hl = 11 + width * 1.8;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hl * Math.cos(ang - 0.42), y2 - hl * Math.sin(ang - 0.42));
  ctx.lineTo(x2 - hl * Math.cos(ang + 0.42), y2 - hl * Math.sin(ang + 0.42));
  ctx.closePath(); ctx.fill();
}
function dashLine(x1, y1, x2, y2, color, w, d) {
  ctx.save(); ctx.setLineDash(d || [7, 7]);
  ctx.strokeStyle = color; ctx.lineWidth = w || 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
~~~

**物理量可视化**：矢量长度随物理量变化，观众一眼看懂"什么在变"。

~~~js
var vyLen = 26 + 150 * q;                  // q 是运动进度 0→1
arrow(bx, by, bx + 104, by, '#2563eb', 2.5);          // vx：长度恒定
arrow(bx, by, bx, by + vyLen, '#f59e0b', 2.5);        // vy：越来越长
arrow(bx, by, bx + 104, by + vyLen, 'rgba(22,163,74,0.90)', 2);  // 合速度
~~~

## 4. 轨迹逐点生长

~~~js
ctx.save();
ctx.setLineDash([6, 8]);
ctx.strokeStyle = 'rgba(15,23,42,0.55)'; ctx.lineWidth = 2;
ctx.beginPath();
for (var i = 0; i <= 60; i++) {                 // 只画到当前进度 q
  var u = (i / 60) * q;
  var px = ox + XS * u, py = oy + YS * u * u;
  if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
}
ctx.stroke();
ctx.restore();
~~~

## 5. 等时间间隔"幽灵点"

用**等时间**取样、而不是等距离，能让"匀速 vs 加速"自己说出来：

~~~js
for (var k = 1; k <= 8; k++) {
  var tk = k / 8;
  if (tk > q + 0.001) break;                     // 未来时刻不提前暴露
  var gx = ox + XS * tk, gy = oy + YS * tk * tk;
  ctx.fillStyle = 'rgba(96,165,250,0.22)';
  ctx.beginPath(); ctx.arc(gx, gy, 6, 0, TAU); ctx.fill();
  dashLine(gx, gy, gx, oy, 'rgba(37,99,235,0.14)', 1, [4, 6]);   // 投影到 x 轴
  dashLine(ox, gy, gx, gy, 'rgba(249,115,22,0.14)', 1, [4, 6]);   // 投影到 y 轴
}
~~~

## 6. 曲线随时间绘制（示波器感）

~~~js
ctx.strokeStyle = 'rgba(249,115,22,0.95)'; ctx.lineWidth = 3;
ctx.beginPath();
for (var i = 0; i <= 220; i++) {
  var tt = (i / 220) * lt;                       // 只画到"现在"
  var xx = gx0 + gw * (tt / dur);
  var yy = gy0 - 62 - 74 * Math.sin(TAU * f * tt);
  if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
}
ctx.stroke();
// 曲线前端的光点 + 到时间轴的垂线
ctx.fillStyle = '#f59e0b';
ctx.beginPath(); ctx.arc(cxp, cyp, 6, 0, TAU); ctx.fill();
dashLine(cxp, cyp, cxp, gy0, 'rgba(245,158,11,0.35)', 1, [4, 6]);
~~~

## 7. 圆周运动三件套

~~~js
var th = -Math.PI / 2 + TAU * f * lt;
var px = cx + r * Math.cos(th), py = cy + r * Math.sin(th);

dashLine(cx, cy, px, py, 'rgba(15,23,42,0.75)', 1.8, [7, 6]);   // 半径
var tx = -Math.sin(th), ty = Math.cos(th);
arrow(px, py, px + tx * 130, py + ty * 130, '#2563eb', 3);         // 切向速度
arrow(px, py, px - Math.cos(th) * 96, py - Math.sin(th) * 96, '#dc2626', 3);  // 指向圆心

ctx.save();                                                        // 运动点发光
ctx.shadowColor = 'rgba(37,99,235,0.45)'; ctx.shadowBlur = 24;
ctx.fillStyle = '#1d4ed8'; ctx.beginPath(); ctx.arc(px, py, 12, 0, TAU); ctx.fill();
ctx.restore();

ctx.strokeStyle = 'rgba(37,99,235,0.5)'; ctx.lineWidth = 4;       // 残影弧
ctx.beginPath(); ctx.arc(cx, cy, r, th - 1.7, th); ctx.stroke();
~~~

## 8. 卡片错峰入场

~~~js
for (var i = 0; i < cards.length; i++) {
  var ap = ease((lt - 0.45 - i * 0.65) / 0.6);     // 每张卡晚 0.65s
  if (ap <= 0.001) continue;
  var y = y0 + (1 - ap) * 26;                      // 从下方 26px 滑入
  rr(x, y, cw, ch, 20);
  ctx.fillStyle = 'rgba(255,255,255,' + (0.99 * ap) + ')'; ctx.fill();
  ctx.strokeStyle = 'rgba(37,99,235,' + (0.42 * ap) + ')'; ctx.lineWidth = 1.6; ctx.stroke();
  ...
}
~~~

**只出现、不消失**：画面元素一旦入场就留在原地，观众的视线不用追。

## 9. 进度条与交叉淡入

~~~js
// 底部进度条
var pg = ctx.createLinearGradient(0, 0, W, 0);
pg.addColorStop(0, '#2563eb'); pg.addColorStop(1, '#f97316');
ctx.fillStyle = 'rgba(15,23,42,0.10)'; ctx.fillRect(0, H - 5, W, 3);
ctx.fillStyle = pg; ctx.fillRect(0, H - 5, W * (t / TOTAL), 3);

// 交叉淡入
if (idx > 0 && lt < 0.5) {
  var prev = SEG[idx - 1];
  ctx.globalAlpha = 1;
  SCENES[prev.id](prev.dur, prev.dur);   // 上一场景的终态
  ctx.globalAlpha = lt / 0.5;            // 当前场景渐显
}
SCENES[s.id](lt, s.dur);
ctx.globalAlpha = 1;
~~~

## 10. 确定性伪随机

需要"随机感"又必须可复现时，用序号派生，别调 `Math.random()`：

~~~js
for (var i = 0; i < 48; i++) {
  var sx = (i * 197.3 + lt * (11 + (i % 6) * 4)) % (W + 120) - 60;
  var sy = (i * 113.7 + Math.sin(lt * 0.5 + i * 0.7) * 40 + lt * (4 + (i % 4) * 5)) % (H + 120) - 60;
  ctx.fillStyle = 'rgba(96,165,250,' + (0.08 + 0.18 * ((i % 5) / 5)) + ')';
  ctx.beginPath(); ctx.arc(sx, sy, 1 + (i % 3) * 0.9, 0, TAU); ctx.fill();
}
~~~

## 11. LaTeX 公式层（物理量 & 公式）

**物理量和公式不要用 canvas 拼字符**，全部交给 KaTeX。页面分两层：

~~~html
<link rel="stylesheet" href="vendor/katex/katex-inline.css">
<div id="stage">
  <canvas id="cv" width="1280" height="720"></canvas>
  <div id="math"></div>          <!-- 公式层，铺在 canvas 上面 -->
</div>
<script src="vendor/katex/katex.min.js"></script>
~~~

声明一条公式（tex 写 LaTeX；JS 字符串里反斜杠要双写）：

~~~js
math({ id: 'sp-t', seg: 'spring', tex: 'T = 2\\pi\\sqrt{\\dfrac{m}{k}}', size: 28,
  place: function (lt) { return { x: 784, y: 348, a: appear(lt, 0.4) }; } });
~~~

挂在运动的矢量上（位置每帧算，和画面共用同一套几何）：

~~~js
math({ id: 'pj-vx', seg: 'projectile', tex: 'v_x', size: 24, color: '#2563eb',
  place: function (lt, dur) {
    var b = projBall(clamp(lt / (dur * 0.78), 0, 1));
    return { x: b.x + 122, y: b.y, a: 1 };
  } });
~~~

同步函数（在 render 里、画布画完之后调用）：

~~~js
function syncMath(idx, lt, prevIdx) {
  MATH.forEach(function (f) {
    var pos = null, a = 0;
    if (f.seg === SEG[idx].id) {
      pos = f.place(lt, SEG[idx].dur);
      a = (pos.a === undefined ? 1 : pos.a) * (idx > 0 && lt < FADE ? lt / FADE : 1);
    } else if (prevIdx >= 0 && f.seg === SEG[prevIdx].id) {
      pos = f.place(SEG[prevIdx].dur, SEG[prevIdx].dur);   // 交叉淡出时保持上一场景终态
      a = (pos.a === undefined ? 1 : pos.a);
    }
    f.el.style.opacity = a;
    if (pos) f.el.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px) translate(' +
      ((pos.anchor || f.anchor) === 'center' ? '-50%' : '0') + ',-50%)';
  });
}
~~~

要点：

- `place()` 返回的 `x, y` 是公式盒子的位置，`y` 是**垂直中心**；`anchor: 'center'` 再横向居中。
- 字号参考：面板公式 28–34，矢量/坐标标签 20–24。
- 标签颜色跟随它标注的矢量（`v` 蓝、`F` 红、`v_y` 琥珀），可读性明显更好。
- 中文不要写进 tex：KaTeX 字体没有中文字形，`F_{\text{向心}}` 会掉到 fallback 字体，很丑。中文说明留在 canvas 上。
- `\dfrac` 会明显变高，面板要预留约 70px；挤不下就换 `\frac`（自动用脚本号字）。
- 截图工具必须 `await document.fonts.ready`，否则第一帧可能落在 fallback 字体上。

重建内联字体的 CSS（升级 KaTeX 时）：

~~~js
let css = fs.readFileSync(dist + '/katex.min.css', 'utf8');
css = css.replace(/,url\(fonts\/[^)]+\.(woff|ttf)\)\s*format\("(woff|truetype)"\)/g, '');   // 只留 woff2
css = css.replace(/url\(["']?fonts\/([^"')]+\.woff2)["']?\)/g, (m, name) =>
  'url(data:font/woff2;base64,' + fs.readFileSync(path.join(dist, 'fonts', name)).toString('base64') + ')');
~~~

