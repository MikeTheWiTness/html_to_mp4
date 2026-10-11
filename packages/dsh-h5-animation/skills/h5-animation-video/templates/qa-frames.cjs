// 阶段二·画面体检：抽关键帧 + 中间帧 + 转场帧，逐帧核查压字/重叠/出界/缺内容/不确定性。
//
//   node qa-frames.cjs                    每个场景 5 帧（近首/近尾关键帧 + 3 个中间帧）+ 每个转场 1 帧
//   node qa-frames.cjs --per-scene 3      每个场景抽 N 帧
//   node qa-frames.cjs --at 2.5 9 16      只抽指定时刻（秒）
//   node qa-frames.cjs --real             用 work/timeline.json 的真实时间轴（出片后复检）
//   node qa-frames.cjs --strict           warn 也算失败
//   node qa-frames.cjs --json             结构化输出到 stdout
//
// 抽帧后逐帧核查：
//   文字出界 / 压进度条 / 文字互相重叠 / 公式压文字 / 公式互压 / 公式出界
//   空白帧（画面几乎没有墨迹）/ 同场景内墨迹骤降（元素中途消失）
//   确定性：同一个 t 多次渲染的像素必须一致（抓 Math.random() 与累积状态）
//   页面 pageerror / console.error
//
// 产物：work/qa/frames/*.png（干净抽帧）、work/qa/flagged/*.png（红框标注）、work/qa/frames.json
// 退出码：有 error = 1；只有 warn 或全过 = 0（--strict 时 warn 也算 1）。
const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const req = createRequire(__filename);
const HERE = __dirname;
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const STRICT = argv.includes('--strict');
const USE_REAL = argv.includes('--real');
const NL = String.fromCharCode(10);

function resolveProject() {
  for (const d of [process.cwd(), HERE]) {
    if (fs.existsSync(path.join(d, 'script.json'))) return d;
  }
  return HERE;
}
const PROJECT = resolveProject();
const WORK = path.join(PROJECT, 'work');
const QA_DIR = path.join(WORK, 'qa');
const FRAMES_DIR = path.join(QA_DIR, 'frames');
const FLAG_DIR = path.join(QA_DIR, 'flagged');

const MIN_ALPHA = 0.15;
const OVERLAP_MIN_AREA = 9;      // px^2
const OVERLAP_RATIO = 0.06;      // 占较小盒子的比例
const INK_DARK = 205;            // 平均亮度低于此值算「墨迹」（白底与 10% 网格不计）
const BLANK_INK = 0.002;
const MAX_FINDINGS = 400;

const findings = [];
const seenFindings = new Set();
function add(level, code, message, extra) {
  if (findings.length >= MAX_FINDINGS) return;
  const key = code + '|' + message;
  if (seenFindings.has(key)) return;
  seenFindings.add(key);
  findings.push(Object.assign({ level: level, code: code, message: message }, extra || {}));
}
function err(code, message, extra) { add('error', code, message, extra); }
function warn(code, message, extra) { add('warn', code, message, extra); }
function cleanErr(e) {
  const m = String(e && e.message ? e.message : e);
  return m.split(NL)[0].replace(/^page\.evaluate:\s*/, '').slice(0, 200);
}
function pad2(n) { return String(n).padStart(2, '0'); }
function safeName(s) { return String(s).replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 80); }

function area(b) { return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0); }
function inter(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

function loadCfg() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT, 'script.json'), 'utf8'));
}

function estimateTimeline(cfg) {
  const cps = cfg.cps || 4.5;
  const lead = cfg.lead === undefined ? 0.35 : cfg.lead;
  const tail = cfg.tail === undefined ? 0.6 : cfg.tail;
  const minDur = cfg.minDur === undefined ? 2.4 : cfg.minDur;
  const PUNCT = '\uff0c\u3002\uff1a\uff1b\u3001\uff01\uff1f,.:;!?\uff08\uff09()\u300c\u300d\u201c\u201d" ';
  let acc = 0;
  const segments = (cfg.segments || []).map(function (s) {
    let chars = 0, pauses = 0;
    const t = String(s.text || '');
    for (let i = 0; i < t.length; i++) { if (PUNCT.indexOf(t[i]) >= 0) pauses++; else chars++; }
    const dur = Math.max(minDur, lead + chars / cps + pauses * 0.18 + tail);
    const seg = { id: s.id, start: +acc.toFixed(4), dur: +dur.toFixed(4) };
    acc += dur;
    return seg;
  });
  return { fps: cfg.fps || 30, segments: segments, estimated: true };
}

function normaliseTimeline(tl, cfg) {
  return { fps: tl.fps || cfg.fps || 30, segments: (tl.segments || []).map(function (s) { return { id: s.id, start: +s.start, dur: +s.dur }; }), estimated: false };
}

/* ---------------- 页面内探测器 ---------------- */

function qaInit() {
  var cur = [];
  function fontSize(font) {
    var m = /(\d+(?:\.\d+)?)px/.exec(font || '');
    return m ? parseFloat(m[1]) : 16;
  }
  function alphaOf(ctx, styleKey) {
    var a = typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1;
    var style = ctx[styleKey];
    if (typeof style === 'string') {
      var m = /rgba?\(([^)]*)\)/.exec(style);
      if (m) {
        var parts = m[1].split(',');
        if (parts.length >= 4) { var v = parseFloat(parts[3]); if (isFinite(v)) a *= v; }
      }
    }
    return a;
  }
  function record(ctx, raw, x, y, styleKey) {
    var t = String(raw);
    if (!t || !t.replace(/\s/g, '')) return;
    var a = alphaOf(ctx, styleKey);
    if (!(a > 0.02)) return;
    var metrics;
    try { metrics = ctx.measureText(t); } catch (e) { return; }
    var w = metrics.width || 0;
    if (!(w > 0)) return;
    var size = fontSize(ctx.font);
    var asc = (typeof metrics.actualBoundingBoxAscent === 'number' && isFinite(metrics.actualBoundingBoxAscent)) ? metrics.actualBoundingBoxAscent : size * 0.8;
    var desc = (typeof metrics.actualBoundingBoxDescent === 'number' && isFinite(metrics.actualBoundingBoxDescent)) ? metrics.actualBoundingBoxDescent : size * 0.22;
    var x0;
    if (ctx.textAlign === 'center') x0 = x - w / 2;
    else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') x0 = x - w;
    else x0 = x;
    var y0, y1;
    var bl = ctx.textBaseline;
    if (bl === 'middle') { y0 = y - (asc + desc) / 2; y1 = y + (asc + desc) / 2; }
    else if (bl === 'top' || bl === 'hanging') { y0 = y; y1 = y + asc + desc; }
    else if (bl === 'bottom' || bl === 'ideographic') { y0 = y - asc - desc; y1 = y; }
    else { y0 = y - asc; y1 = y + desc; }
    cur.push({ text: t, x0: x0, y0: y0, x1: x0 + w, y1: y1, alpha: a, font: ctx.font || '', align: ctx.textAlign || 'left', baseline: bl || 'alphabetic' });
  }
  var proto = CanvasRenderingContext2D.prototype;
  var origFill = proto.fillText, origStroke = proto.strokeText;
  proto.fillText = function (text, x, y) { try { record(this, text, x, y, 'fillStyle'); } catch (e) {} return origFill.apply(this, arguments); };
  proto.strokeText = function (text, x, y) { try { record(this, text, x, y, 'strokeStyle'); } catch (e) {} return origStroke.apply(this, arguments); };
  function canvasHash() {
    var cv = document.getElementById('cv');
    if (!cv) return '0';
    var data;
    try { data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return 'x'; }
    var h = 2166136261;
    for (var i = 0; i < data.length; i += 17) { h ^= data[i]; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  window.__QA = {
    reset: function () { cur = []; },
    dump: function () { return cur.slice(); },
    hash: canvasHash,
    ink: function () {
      var cv = document.getElementById('cv');
      if (!cv) return { inkRatio: -1, samples: 0 };
      var data;
      try { data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return { inkRatio: -1, samples: 0 }; }
      var w = cv.width, h = cv.height, ink = 0, n = 0, step = 4;
      for (var yy = 0; yy < h; yy += step) {
        for (var xx = 0; xx < w; xx += step) {
          var i = (yy * w + xx) * 4;
          n++;
          if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 205) ink++;
        }
      }
      return { inkRatio: n ? ink / n : 0, samples: n };
    }
  };
}

/* ---------------- 浏览器 ---------------- */

function playwrightCandidates() {
  const tried = [];
  const push = function (p) { if (p && tried.indexOf(p) === -1) tried.push(p); };
  if (process.env.PW_CORE) push(process.env.PW_CORE);
  for (const b of [PROJECT, HERE, process.cwd()]) {
    try { push(req.resolve('playwright-core', { paths: [b] })); } catch (e) {}
  }
  push(path.join(PROJECT, 'node_modules/playwright-core'));
  push(path.join(HERE, 'node_modules/playwright-core'));
  const roots = (process.env.PW_PNPM_ROOTS || '').split(':').filter(Boolean);
  roots.push(path.join(PROJECT, 'node_modules/.pnpm'));
  roots.push(path.join(HERE, 'node_modules/.pnpm'));
  roots.push(path.join(os.homedir(), 'deepseek-harness/deepseek-harness/node_modules/.pnpm'));
  for (const root of roots) {
    try {
      const dirs = fs.readdirSync(root)
        .filter(function (d) { return d.indexOf('playwright-core@') === 0; })
        .sort(function (a, b) { return ((a.indexOf('alpha') >= 0 ? 1 : 0) - (b.indexOf('alpha') >= 0 ? 1 : 0)) || a.localeCompare(b); });
      for (const d of dirs) push(path.join(root, d, 'node_modules/playwright-core'));
    } catch (e) {}
  }
  return tried.filter(function (p) { return fs.existsSync(p); });
}

async function launchChromium() {
  const cands = playwrightCandidates();
  if (!cands.length) throw new Error('找不到 playwright-core，请用环境变量 PW_CORE 指向其安装目录');
  let lastErr = null;
  for (const cand of cands) {
    try {
      const browser = await req(cand).chromium.launch();
      return browser;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('没有可用的 playwright-core');
}

/* ---------------- 逐帧分析 ---------------- */

function visibleTexts(raw) {
  const out = [];
  const seen = {};
  for (const t of raw) {
    if (!(t.alpha >= MIN_ALPHA)) continue;
    if (!(t.x1 > t.x0) || !(t.y1 > t.y0)) continue;
    const key = t.text + '|' + Math.round(t.x0) + ',' + Math.round(t.y0) + ',' + Math.round(t.x1) + ',' + Math.round(t.y1);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(t);
  }
  return out;
}

function visibleMath(raw) {
  return raw.filter(function (m) { return m.opacity >= MIN_ALPHA && (m.x1 - m.x0) > 1 && (m.y1 - m.y0) > 1; });
}

function analyzeFrame(sample, texts, math, ink, W, H, frameFindings) {
  function push(level, code, message, boxes) {
    frameFindings.push({ level: level, code: code, message: message, boxes: boxes || [] });
  }
  for (const t of texts) {
    const outL = t.x0 < -2, outR = t.x1 > W + 2, outT = t.y0 < -2, outB = t.y1 > H + 2;
    if (outL || outR || outT || outB) {
      const fully = t.x1 < 4 || t.x0 > W - 4 || t.y1 < 4 || t.y0 > H - 4;
      push(fully ? 'error' : 'warn', 'text-outside', '文字出界或几乎完全在画布外：「' + t.text.slice(0, 24) + '」', [t]);
    }
    if (t.y1 > H - 6 && t.y0 < H - 4) {
      push('warn', 'text-progress-bar', '文字压到底部进度条：「' + t.text.slice(0, 24) + '」', [t]);
    }
  }
  let overlaps = 0;
  for (let i = 0; i < texts.length && overlaps < 6; i++) {
    for (let j = i + 1; j < texts.length && overlaps < 6; j++) {
      const a = texts[i], b = texts[j];
      const ov = inter(a, b);
      if (ov > OVERLAP_MIN_AREA && ov > OVERLAP_RATIO * Math.min(area(a), area(b))) {
        overlaps++;
        if (sample.kind === 'crossfade') {
          push('warn', 'crossfade-overlap', '转场交叉淡入时两场景文字叠在一起：「' + a.text.slice(0, 18) + '」×「' + b.text.slice(0, 18) + '」', [a, b]);
        } else {
          push('warn', 'text-overlap', '文字互相重叠：「' + a.text.slice(0, 18) + '」×「' + b.text.slice(0, 18) + '」', [a, b]);
        }
      }
    }
  }
  let mathOverText = 0;
  for (const m of math) {
    for (const t of texts) {
      if (mathOverText >= 6) break;
      const ov = inter(m, t);
      if (ov > 6) {
        mathOverText++;
        push('error', 'math-over-text', '公式压住文字：' + (m.id || '公式') + ' × 「' + t.text.slice(0, 18) + '」', [m, t]);
      }
    }
  }
  let mathOverlap = 0;
  for (let i = 0; i < math.length && mathOverlap < 6; i++) {
    for (let j = i + 1; j < math.length && mathOverlap < 6; j++) {
      const ov = inter(math[i], math[j]);
      if (ov > OVERLAP_MIN_AREA) {
        mathOverlap++;
        push('error', 'math-overlap', '两个公式盒子重叠：' + (math[i].id || '?') + ' × ' + (math[j].id || '?'), [math[i], math[j]]);
      }
    }
  }
  for (const m of math) {
    if (m.x0 < -2 || m.y0 < -2 || m.x1 > W + 2 || m.y1 > H + 2) {
      push('warn', 'math-outside', '公式出界：' + (m.id || '公式'), [m]);
    }
  }
  if (ink.inkRatio >= 0 && ink.inkRatio < BLANK_INK) {
    push('error', 'blank-frame', '画面几乎没有墨迹（ink ' + (ink.inkRatio * 100).toFixed(3) + '%）：疑似空白 / 内容没画出来');
  }
}

/* ---------------- 主流程 ---------------- */

async function main() {
  let cfg;
  try { cfg = loadCfg(); }
  catch (e) { console.error('读不了 script.json：' + e.message); process.exit(1); }
  const W = cfg.width || 1280;
  const H = cfg.height || 720;

  let timeline = estimateTimeline(cfg);
  if (USE_REAL) {
    const realPath = path.join(WORK, 'timeline.json');
    if (fs.existsSync(realPath)) {
      try { timeline = normaliseTimeline(JSON.parse(fs.readFileSync(realPath, 'utf8')), cfg); }
      catch (e) { warn('timeline-unreadable', 'work/timeline.json 读不了，退回预估时间轴：' + e.message); }
    } else {
      warn('timeline-missing', '--real 但 work/timeline.json 不存在，退回预估时间轴');
    }
  }
  if (!fs.existsSync(path.join(PROJECT, 'animation.html'))) { console.error('找不到 ' + path.join(PROJECT, 'animation.html')); process.exit(1); }
  const segments = (timeline.segments || []).filter(function (s) { return isFinite(s.start) && isFinite(s.dur); });
  if (!segments.length) { console.error('时间轴里没有可用场景，检查 script.json 的 segments'); process.exit(1); }

  fs.mkdirSync(QA_DIR, { recursive: true });
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.rmSync(FLAG_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', function (e) { pageErrors.push(String(e)); });
  page.on('console', function (m) { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.addInitScript(qaInit);
  await page.addInitScript(function (tl) { window.__VM = tl; }, timeline);
  await page.goto('file://' + path.join(PROJECT, 'animation.html'));
  await page.waitForFunction('window.__ready === true', null, { timeout: 15000 }).catch(function () {});
  await page.evaluate(function () { return document.fonts.ready; });
  const meta = await page.evaluate(function () {
    return { ready: window.__ready === true, fade: typeof window.__FADE === 'number' ? window.__FADE : 0.5, scenes: Array.isArray(window.__SCENES) ? window.__SCENES : [] };
  });
  if (!meta.ready) err('not-ready', 'animation.html 没有把 window.__ready 置为 true：页面可能报错，逐帧截图不可靠');

  const FADE = meta.fade;
  const perScene = (function () {
    const idx = argv.indexOf('--per-scene');
    if (idx < 0) return 5;
    const v = parseInt(argv[idx + 1], 10);
    return isFinite(v) && v > 0 ? Math.min(v, 20) : 5;
  })();
  function fractions(n) {
    if (n === 1) return [0.5];
    const lo = 0.06, hi = 0.94, out = [];
    for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * (i / (n - 1)));
    return out;
  }

  const queue = [];
  const atIdx = argv.indexOf('--at');
  if (atIdx >= 0) {
    const times = argv.slice(atIdx + 1).map(Number).filter(function (n) { return isFinite(n); });
    times.forEach(function (t, i) { queue.push({ name: '抽帧_' + pad2(i + 1) + '_' + t.toFixed(2) + 's', t: t, scene: '(指定)', kind: 'at' }); });
  } else {
    segments.forEach(function (seg, i) {
      fractions(perScene).forEach(function (f) {
        const t = seg.start + seg.dur * f;
        queue.push({ name: '场景' + pad2(i + 1) + '_' + safeName(seg.id) + '_' + t.toFixed(2) + 's', t: t, scene: seg.id, kind: f <= 0.1 ? 'first' : (f >= 0.9 ? 'last' : 'mid') });
      });
      if (i > 0 && FADE > 0) {
        const t = seg.start + FADE / 2;
        queue.push({ name: '转场' + pad2(i) + '_' + safeName(seg.id) + '_' + t.toFixed(2) + 's', t: t, scene: seg.id, kind: 'crossfade' });
      }
    });
  }

  const samples = [];
  for (const item of queue) {
    const data = await page.evaluate(function (t) {
      window.__QA.reset();
      window.__seek(t);
      return { texts: window.__QA.dump(), ink: window.__QA.ink() };
    }, item.t);
    const mathRaw = await page.evaluate(function () {
      const stage = document.getElementById('stage');
      const sr = stage ? stage.getBoundingClientRect() : { left: 0, top: 0 };
      const nodes = document.querySelectorAll('#math .f');
      const MATH = window.__MATH || [];
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const op = parseFloat(getComputedStyle(el).opacity || '0');
        const r = el.getBoundingClientRect();
        const m = MATH[i] || {};
        out.push({ i: i, id: m.id || '', seg: m.seg || '', opacity: isFinite(op) ? op : 1, x0: r.left - sr.left, y0: r.top - sr.top, x1: r.right - sr.left, y1: r.bottom - sr.top });
      }
      return out;
    });
    const texts = visibleTexts(data.texts);
    const math = visibleMath(mathRaw);
    const frameFindings = [];
    analyzeFrame(item, texts, math, data.ink, W, H, frameFindings);
    for (const f of frameFindings) {
      add(f.level, f.code, f.message, { sample: item.name, t: +item.t.toFixed(3), scene: item.scene, boxes: f.boxes });
    }
    const cleanPath = path.join(FRAMES_DIR, item.name + '.png');
    await page.screenshot({ path: cleanPath, type: 'png' });
    if (frameFindings.length) {
      await annotate(page, frameFindings);
      await page.screenshot({ path: path.join(FLAG_DIR, item.name + '.png'), type: 'png' });
      await clearAnnotate(page);
    }
    samples.push({ name: item.name, t: +item.t.toFixed(3), scene: item.scene, kind: item.kind, texts: texts.length, math: math.length, inkRatio: data.ink.inkRatio, issues: frameFindings.length });
    console.log((frameFindings.length ? '  ✗ ' : '  ✓ ') + item.name + '  ink ' + (data.ink.inkRatio * 100).toFixed(2) + '%  文字 ' + texts.length + '  公式 ' + math.length + (frameFindings.length ? '  问题 ' + frameFindings.length : ''));
  }

  // 同场景墨迹骤降：元素中途消失
  const byScene = {};
  for (const s of samples) { (byScene[s.scene] = byScene[s.scene] || []).push(s); }
  for (const scene of Object.keys(byScene)) {
    // 只用「进场后」的中间帧/尾帧做基线：入场动画与交叉淡入本来就会短暂偏淡，不算缺内容
    const list = byScene[scene].filter(function (s) { return s.inkRatio >= 0 && s.kind !== 'first' && s.kind !== 'crossfade'; });
    if (list.length < 3) continue;
    const sorted = list.map(function (s) { return s.inkRatio; }).sort(function (a, b) { return a - b; });
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median < 0.004) continue;
    for (const s of list) {
      if (s.inkRatio < 0.35 * median && median - s.inkRatio > 0.02) {
        warn('ink-drop', '场景 ' + scene + ' 在 ' + s.name + ' 的墨迹明显偏低（ink ' + (s.inkRatio * 100).toFixed(2) + '% vs 中位 ' + (median * 100).toFixed(2) + '%）：可能有元素中途消失', { sample: s.name, t: s.t, scene: scene });
      }
    }
  }

  // 确定性：同一个 t 反复渲染必须完全一致；__seek 之后不能再动
  // 每个场景都抽一个时刻做确定性检查（覆盖到每个 scene 的随机/累积状态）
  const detSeen = {};
  const detTimes = [];
  for (const item of queue) {
    if (detSeen[item.scene]) continue;
    detSeen[item.scene] = true;
    if (isFinite(item.t)) detTimes.push({ name: item.name, t: +item.t.toFixed(3) });
    if (detTimes.length >= 6) break;
  }
  for (const d of detTimes) {
    const r = await page.evaluate(async function (t) {
      window.__seek(t);
      const a = window.__QA.hash();
      await new Promise(function (res) {
        let done = false;
        requestAnimationFrame(function () { requestAnimationFrame(function () { done = true; res(); }); });
        setTimeout(function () { if (!done) res(); }, 250);
      });
      const b = window.__QA.hash();
      window.__seek(t + 0.41);
      window.__seek(t);
      const c = window.__QA.hash();
      return { a: a, b: b, c: c };
    }, d.t);
    if (r.a !== r.c) err('nondeterministic', '画面不是 t 的纯函数：' + d.name + ' 两次渲染像素不一致（检查 Math.random() / 累积状态 / 时间变量）', { sample: d.name, t: d.t });
    if (r.a !== r.b) err('raf-not-stopped', 'window.__seek 之后画面还在变：' + d.name + '（seek 应停掉 requestAnimationFrame）', { sample: d.name, t: d.t });
  }

  if (pageErrors.length) err('page-error', '页面报错：' + pageErrors.slice(0, 3).join(' | '));

  await browser.close();

  const errors = findings.filter(function (f) { return f.level === 'error'; });
  const warns = findings.filter(function (f) { return f.level === 'warn'; });
  const ok = errors.length === 0 && (!STRICT || warns.length === 0);
  const report = {
    schema: 1,
    kind: 'frames',
    project: PROJECT,
    generatedAt: new Date().toISOString(),
    timeline: USE_REAL && !timeline.estimated ? 'real' : 'estimated',
    strict: STRICT,
    ok: ok,
    summary: { errors: errors.length, warns: warns.length, samples: samples.length, scenes: segments.length, perScene: perScene },
    samples: samples,
    findings: findings
  };
  fs.writeFileSync(path.join(QA_DIR, 'frames.json'), JSON.stringify(report, null, 2) + NL);

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + NL);
  } else {
    const lines = [];
    lines.push('画面体检（抽帧）  ' + PROJECT);
    lines.push('  时间轴 ' + report.timeline + ' · 抽帧 ' + samples.length + ' 张 · 干净帧 work/qa/frames/ · 标注 problem 帧 work/qa/flagged/');
    if (!errors.length && !warns.length) lines.push('  ✓ 通过：没有出界/重叠/压字/空白/不确定');
    for (const f of errors) lines.push('  ✗ [' + f.code + '] ' + (f.sample ? f.sample + '  ' : '') + f.message);
    for (const f of warns) lines.push('  ! [' + f.code + '] ' + (f.sample ? f.sample + '  ' : '') + f.message);
    lines.push('  error ' + errors.length + ' / warn ' + warns.length + ' · 报告 work/qa/frames.json');
    process.stdout.write(lines.join(NL) + NL);
  }
  process.exit(ok ? 0 : 1);
}

async function annotate(page, frameFindings) {
  const boxes = [];
  for (const f of frameFindings) for (const b of f.boxes || []) boxes.push(b);
  if (!boxes.length) return;
  await page.evaluate(function (list) {
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect();
    const old = document.getElementById('__qa_overlay');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__qa_overlay';
    host.style.position = 'absolute';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = sr.width + 'px';
    host.style.height = sr.height + 'px';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '99999';
    for (const b of list) {
      const d = document.createElement('div');
      d.style.position = 'absolute';
      d.style.left = (b.x0 - 2) + 'px';
      d.style.top = (b.y0 - 2) + 'px';
      d.style.width = Math.max(3, (b.x1 - b.x0) + 4) + 'px';
      d.style.height = Math.max(3, (b.y1 - b.y0) + 4) + 'px';
      d.style.border = '2px solid #dc2626';
      d.style.boxSizing = 'border-box';
      d.style.background = 'rgba(220,38,38,0.06)';
      host.appendChild(d);
    }
    stage.appendChild(host);
  }, boxes);
}

async function clearAnnotate(page) {
  await page.evaluate(function () { const o = document.getElementById('__qa_overlay'); if (o) o.remove(); });
}

main().catch(function (e) {
  console.error('失败: ' + cleanErr(e));
  process.exit(1);
});

