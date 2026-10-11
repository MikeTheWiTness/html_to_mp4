// 阶段二·公式体检：确保画面上的物理量与公式都走 KaTeX，而不是在 canvas 上拼字符。
//
//   node qa-katex.cjs              静态 + 运行时（运行时需要 playwright-core + Chromium）
//   node qa-katex.cjs --static     只做静态检查，不开浏览器
//   node qa-katex.cjs --json       结构化输出到 stdout（同时写 work/qa/katex.json）
//   node qa-katex.cjs --quiet      只打印问题
//   node qa-katex.cjs --strict     warn 也算失败
//
// 静态查：
//   1) vendor/katex 资源是否随项目带上、animation.html 是否引用
//   2) canvas 文本里有没有 LaTeX 命令 / Unicode 上下标 / ^ _ / 根号 / 希腊字母 / 单位比值公式
//   3) math({ tex }) 的 tex 里有没有中文（KaTeX 无中文字形）
//   4) script.json 的段 id 与 animation.html 的 SCENES / math({ seg }) 是否对得上
// 运行时查：
//   5) katex 全局是否加载；逐条 tex 用 renderToString(throwOnError) 试解析
//   6) 页面实际渲染出的 .katex-error 节点；KaTeX 字体是否就绪
//
// 退出码：有 error = 1；只有 warn 或全过 = 0（--strict 时 warn 也算 1）。
// 结果写入 work/qa/katex.json，由 node qa.cjs 汇总成出片闸门。
const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const req = createRequire(__filename);
const HERE = __dirname;
const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes('--static');
const AS_JSON = argv.includes('--json');
const STRICT = argv.includes('--strict');
const QUIET = argv.includes('--quiet');
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
const HTML_PATH = path.join(PROJECT, 'animation.html');

const findings = [];
function add(level, code, message, extra) {
  findings.push(Object.assign({ level: level, code: code, message: message }, extra || {}));
}
function err(code, message, extra) { add('error', code, message, extra); }
function warn(code, message, extra) { add('warn', code, message, extra); }
function lineOf(src, index) { return src.slice(0, index).split(NL).length; }
function cleanErr(e) {
  const m = String(e && e.message ? e.message : e);
  return m.split(NL)[0].replace(/^page\.evaluate:\s*/, '').slice(0, 200);
}

/* ---------------- 静态检查 ---------------- */

function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const LITERAL_RE = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g;

function drawCalls(src) {
  const calls = [];
  const callRe = /(?:^|[^\w$])(text|fillText|strokeText)\s*\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    const open = src.indexOf('(', callRe.lastIndex - 1);
    if (open < 0) continue;
    const close = matchParen(src, open);
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    const literals = [];
    LITERAL_RE.lastIndex = 0;
    let lm;
    while ((lm = LITERAL_RE.exec(body))) {
      const value = lm[1] !== undefined ? lm[1] : lm[2];
      literals.push({ value: value, index: open + 1 + lm.index });
    }
    calls.push({ name: m[1], literals: literals });
    callRe.lastIndex = close;
  }
  return calls;
}

const RE_LATEX_CMD = /\\[A-Za-z]{2,}/;
const RE_SUP = /[\u00b2\u00b3\u00b9\u2070-\u207f]/;
const RE_SUB = /[\u2080-\u209f]/;
const RE_GREEK = /[\u0370-\u03ff]/;
const RE_SQRT = /sqrt\s*\(|\u221a/;
const RE_CARET = /\^\s*[0-9A-Za-z({]/;
const RE_UNDER = /_\s*[0-9A-Za-z{]/;
const RE_GREEK_WORD = /\b(alpha|beta|gamma|delta|Delta|theta|lambda|mu|rho|sigma|tau|phi|omega|Omega|epsilon|eta|nu|xi|zeta|psi|chi)\b/;
const RE_CJK = /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function checkCanvasText(html) {
  for (const call of drawCalls(html)) {
    const literals = call.literals.filter(function (l) { return l.value.length > 0; });
    if (!literals.length) continue;
    const joined = literals.map(function (l) { return l.value; }).join(' ');
    const hits = [];
    if (RE_LATEX_CMD.test(joined)) hits.push(['error', 'canvas-latex', 'canvas 文本里出现 LaTeX 命令（公式应交给 math({ tex })）']);
    if (RE_SUP.test(joined) || RE_SUB.test(joined)) hits.push(['error', 'canvas-supsub-unicode', 'canvas 文本里用了 Unicode 上/下标字符']);
    if (RE_CARET.test(joined)) hits.push(['error', 'canvas-caret', 'canvas 文本里出现 ^ 上标']);
    if (RE_UNDER.test(joined)) hits.push(['error', 'canvas-underscore', 'canvas 文本里出现 _ 下标']);
    if (RE_SQRT.test(joined)) hits.push(['error', 'canvas-sqrt', 'canvas 文本里出现根号']);
    if (RE_GREEK.test(joined)) hits.push(['warn', 'canvas-greek', 'canvas 文本里出现希腊字母（物理量请用 KaTeX）']);
    if (RE_GREEK_WORD.test(joined)) hits.push(['warn', 'canvas-greek-word', 'canvas 文本里出现希腊字母英文名']);
    if (/[A-Za-z]\s*=/.test(joined) && /[*/^]/.test(joined)) hits.push(['warn', 'canvas-equation', 'canvas 文本里像是一条公式（= 与运算符同现）']);
    if (!hits.length) continue;
    const anchor = literals[0];
    for (const hit of hits) {
      add(hit[0], hit[1], hit[2] + '：' + anchor.value.slice(0, 60), { line: lineOf(html, anchor.index), snippet: anchor.value.slice(0, 80) });
    }
  }
}

function checkTexCjk(html) {
  const texRe = /tex\s*:\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m, count = 0;
  while ((m = texRe.exec(html))) {
    count++;
    if (RE_CJK.test(m[2])) {
      err('tex-cjk', 'tex 里含中文（KaTeX 无中文字形，中文请留在 canvas 上）：' + m[2].slice(0, 60), { line: lineOf(html, m.index), tex: m[2] });
    }
  }
  return count;
}

function parseSceneIds(html) {
  const ids = [];
  const seen = {};
  function push(id) { if (id && !seen[id]) { seen[id] = true; ids.push(id); } }
  const block = /SCENES\s*=\s*\{([\s\S]*?)\}/.exec(html);
  if (block) {
    const keyRe = /([A-Za-z_$][\w$]*)\s*:/g;
    let k;
    while ((k = keyRe.exec(block[1]))) push(k[1]);
  }
  const assignRe = /SCENES\.([A-Za-z_$][\w$]*)\s*=/g;
  let a;
  while ((a = assignRe.exec(html))) push(a[1]);
  return ids;
}

function parseMathSegs(html) {
  const segs = [];
  const re = /\bseg\s*:\s*(['"])([\w$.-]+)\1/g;
  let m;
  while ((m = re.exec(html))) { if (segs.indexOf(m[2]) < 0) segs.push(m[2]); }
  return segs;
}

function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT, 'script.json'), 'utf8'));
  } catch (e) {
    err('script-json', '读不了 script.json：' + e.message);
    return null;
  }
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
    for (let i = 0; i < t.length; i++) {
      if (PUNCT.indexOf(t[i]) >= 0) pauses++; else chars++;
    }
    const audio = chars / cps + pauses * 0.18;
    const dur = Math.max(minDur, lead + audio + tail);
    const seg = { id: s.id, start: +acc.toFixed(4), dur: +dur.toFixed(4) };
    acc += dur;
    return seg;
  });
  return { fps: cfg.fps || 30, segments: segments };
}

function checkStatic(cfg) {
  if (!fs.existsSync(HTML_PATH)) { err('html-missing', '找不到 ' + HTML_PATH); return null; }
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  for (const rel of ['vendor/katex/katex.min.js', 'vendor/katex/katex-inline.css']) {
    if (!fs.existsSync(path.join(PROJECT, rel))) err('katex-asset-missing', '缺少 ' + rel + '：公式无法离线渲染', { file: rel });
  }
  if (!new RegExp('<script[^>]+vendor/katex/katex\\.min\\.js').test(html)) err('katex-not-referenced', 'animation.html 没有引用 vendor/katex/katex.min.js');
  if (html.indexOf('vendor/katex/katex-inline.css') < 0) err('katex-css-not-referenced', 'animation.html 没有引用 vendor/katex/katex-inline.css');

  checkCanvasText(html);
  const texCount = checkTexCjk(html);

  const sceneIds = parseSceneIds(html);
  if (!sceneIds.length) warn('scenes-not-parsed', '没能从 animation.html 解析出 SCENES 的键：请确认按模板写法注册场景');
  const mathSegs = parseMathSegs(html);

  const segIds = cfg && Array.isArray(cfg.segments) ? cfg.segments.map(function (s) { return s.id; }) : [];
  if (sceneIds.length && cfg && Array.isArray(cfg.segments)) {
    for (const id of segIds) {
      if (sceneIds.indexOf(id) < 0) err('scene-missing', 'script.json 的段 "' + id + '" 在 SCENES 里没有对应画面');
    }
    for (const id of sceneIds) {
      if (segIds.indexOf(id) < 0) warn('scene-extra', 'SCENES 里的 "' + id + '" 在 script.json 里没有旁白段');
    }
    const a = segIds.filter(function (id) { return sceneIds.indexOf(id) >= 0; });
    const b = sceneIds.filter(function (id) { return segIds.indexOf(id) >= 0; });
    if (a.length === b.length && a.join(',') !== b.join(',')) {
      warn('scene-order', 'script.json 的段顺序与 SCENES 注册顺序不一致：' + a.join(' -> ') + ' / ' + b.join(' -> '));
    }
  }
  for (const seg of mathSegs) {
    if (sceneIds.length && sceneIds.indexOf(seg) < 0) err('math-seg-unknown', 'math({ seg: "' + seg + '" }) 指向了不存在的场景');
  }
  if (!/window\.__MATH\s*=/.test(html)) warn('math-not-exported', 'animation.html 没有导出 window.__MATH：运行时逐条公式校验会降级（模板已提供该契约，建议补上）');

  return { sceneIds: sceneIds, mathSegs: mathSegs, texCount: texCount };
}

/* ---------------- 运行时检查 ---------------- */

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
      const chromium = req(cand).chromium;
      const browser = await chromium.launch();
      return browser;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('没有可用的 playwright-core');
}

async function runRuntime(cfg) {
  let browser;
  try { browser = await launchChromium(); }
  catch (e) {
    warn('browser-unavailable', '跳过运行时公式校验（' + cleanErr(e) + '）；静态检查已完成。要跑完整校验先执行 h5video doctor。');
    return { attempted: false, reason: cleanErr(e) };
  }
  const result = { attempted: true, katexLoaded: false, mathCount: 0, fontsStatus: null, fontMain: null, fontMath: null, pageErrors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: cfg.width || 1280, height: cfg.height || 720 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', function (e) { pageErrors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error') pageErrors.push(m.text()); });
    await page.addInitScript(function (tl) { window.__VM = tl; }, estimateTimeline(cfg));
    await page.goto('file://' + HTML_PATH);
    await page.waitForFunction('window.__ready === true', null, { timeout: 15000 }).catch(function () {});
    await page.evaluate(function () { return document.fonts.ready; });
    const probe = await page.evaluate(function () {
      const math = Array.isArray(window.__MATH) ? window.__MATH.map(function (f) {
        return { id: f && f.id ? String(f.id) : '', seg: f && f.seg ? String(f.seg) : '', tex: f && f.tex != null ? String(f.tex) : '' };
      }) : null;
      const errs = [];
      const nodes = document.querySelectorAll('#math .katex-error');
      for (let i = 0; i < nodes.length; i++) errs.push(nodes[i].getAttribute('title') || nodes[i].textContent || '');
      return {
        katexLoaded: typeof katex !== 'undefined',
        math: math,
        errs: errs,
        nodeCount: document.querySelectorAll('#math .f').length,
        fontsStatus: document.fonts.status,
        fontMain: document.fonts.check('1em KaTeX_Main'),
        fontMath: document.fonts.check('1em KaTeX_Math')
      };
    });
    result.katexLoaded = probe.katexLoaded;
    result.mathCount = probe.math ? probe.math.length : 0;
    result.fontsStatus = probe.fontsStatus;
    result.fontMain = probe.fontMain;
    result.fontMath = probe.fontMath;
    if (!probe.katexLoaded) err('katex-not-loaded', '页面里没有 katex 全局对象：vendor/katex/katex.min.js 没生效');
    if (probe.math) {
      for (const f of probe.math) {
        if (!f.tex) { warn('math-empty-tex', '公式 ' + (f.id || '(无 id)') + ' 的 tex 为空'); continue; }
        try {
          await page.evaluate(function (tex) { window.katex.renderToString(tex, { throwOnError: true }); }, f.tex);
        } catch (e) {
          err('tex-parse-error', '公式解析失败 ' + (f.id || '') + '：' + cleanErr(e), { id: f.id, tex: f.tex });
        }
      }
    } else {
      warn('math-not-exported', '页面没有 window.__MATH，无法逐条校验 tex');
    }
    for (const t of probe.errs) err('katex-error-node', '页面渲染出 KaTeX 错误节点：' + String(t).slice(0, 120));
    if (probe.math && probe.math.length !== probe.nodeCount) {
      warn('math-node-mismatch', 'window.__MATH 有 ' + probe.math.length + ' 条，但 #math 里渲染出 ' + probe.nodeCount + ' 个公式盒子');
    }
    if (probe.fontsStatus !== 'loaded') warn('fonts-not-ready', 'document.fonts.status = ' + probe.fontsStatus + '：截图前没等字体就绪');
    if (!probe.fontMain) warn('katex-font-missing', 'KaTeX_Main 字体未加载：公式可能用 fallback 字体渲染');
    if (pageErrors.length) {
      result.pageErrors = pageErrors.slice(0, 5);
      err('page-error', '页面报错：' + pageErrors.slice(0, 3).join(' | '));
    }
    await browser.close();
  } catch (e) {
    try { await browser.close(); } catch (e2) {}
    err('runtime-failed', '运行时校验失败：' + cleanErr(e));
  }
  return result;
}

/* ---------------- 输出 ---------------- */

function printHuman(report) {
  const errors = report.findings.filter(function (f) { return f.level === 'error'; });
  const warns = report.findings.filter(function (f) { return f.level === 'warn'; });
  if (QUIET && !errors.length && !warns.length) return;
  const lines = [];
  lines.push('公式与排版体检（KaTeX）  ' + report.project);
  if (!errors.length && !warns.length) {
    lines.push('  \u2713 通过：canvas 没有拼公式，tex 全部可解析，场景 id 对得上，KaTeX 字体就绪');
  }
  for (const f of errors) lines.push('  \u2717 [' + f.code + '] ' + f.message + (f.line ? '  (animation.html:' + f.line + ')' : ''));
  for (const f of warns) lines.push('  ! [' + f.code + '] ' + f.message + (f.line ? '  (animation.html:' + f.line + ')' : ''));
  lines.push('  公式 ' + report.summary.mathCount + ' 条 · 场景 ' + report.summary.scenes + ' 个 · 旁白段 ' + report.summary.segments + ' 段 · error ' + errors.length + ' / warn ' + warns.length);
  if (report.runtime && report.runtime.attempted === false && report.runtime.reason) lines.push('  （运行时校验已跳过：' + report.runtime.reason + '）');
  lines.push('  报告 work/qa/katex.json');
  process.stdout.write(lines.join(NL) + NL);
}

(async function () {
  const cfg = loadCfg();
  const info = cfg ? checkStatic(cfg) : null;
  let runtime = { attempted: false, reason: '--static' };
  if (!STATIC_ONLY && cfg && info) runtime = await runRuntime(cfg);

  const errors = findings.filter(function (f) { return f.level === 'error'; });
  const warns = findings.filter(function (f) { return f.level === 'warn'; });
  const ok = errors.length === 0 && (!STRICT || warns.length === 0);
  const report = {
    schema: 1,
    kind: 'katex',
    project: PROJECT,
    generatedAt: new Date().toISOString(),
    strict: STRICT,
    staticOnly: STATIC_ONLY,
    ok: ok,
    summary: {
      errors: errors.length,
      warns: warns.length,
      mathCount: runtime.mathCount || (info ? info.texCount : 0),
      scenes: info ? info.sceneIds.length : 0,
      segments: cfg && Array.isArray(cfg.segments) ? cfg.segments.length : 0
    },
    runtime: runtime,
    findings: findings
  };
  fs.mkdirSync(QA_DIR, { recursive: true });
  fs.writeFileSync(path.join(QA_DIR, 'katex.json'), JSON.stringify(report, null, 2) + NL);
  if (AS_JSON) process.stdout.write(JSON.stringify(report, null, 2) + NL);
  else printHuman(report);
  process.exit(ok ? 0 : 1);
})().catch(function (e) {
  console.error('失败: ' + (e && e.message ? e.message : e));
  process.exit(1);
});

