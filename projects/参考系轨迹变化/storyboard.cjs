// 审核阶段工具：不改动任何产物，只把动画按 script.json 的【预估时间轴】渲染成分镜图，
// 让人在生成 MP4 之前先把画面看一遍。
//
// 用法：
//   node storyboard.cjs                  每个场景自动抽 2 帧（场景 25% / 75% 处）
//   node storyboard.cjs --shots 3        每个场景抽 3 帧
//   node storyboard.cjs --at 2.5 9 16    指定时刻（秒）
//   node storyboard.cjs --plan           只打印预估时间轴，不开浏览器
const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const req = createRequire(__filename);
const HERE = __dirname;          // 脚本自身所在目录
const argv = process.argv.slice(2);

// 项目目录：优先"当前工作目录"，其次脚本自身目录。
// 支持两种用法：复制进项目（node storyboard.cjs）、从 templates/ 直接跑
// （node ../../templates/storyboard.cjs）。
function resolveProject() {
  for (const d of [process.cwd(), HERE]) {
    if (fs.existsSync(path.join(d, 'script.json'))) return d;
  }
  return HERE;
}
const PROJECT = resolveProject();
const WORK = path.join(PROJECT, 'work');
const SHOT_DIR = path.join(WORK, 'storyboard');

const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'script.json'), 'utf8'));
const cps = cfg.cps || 4.5;            // 中文语速（字/秒），仅用于审核阶段的预估
const PUNCT = '，。：；、！？,.:;!?（）()「」“”" ';

function estimateAudio(text) {
  let chars = 0, pauses = 0;
  for (const ch of text) {
    if (PUNCT.indexOf(ch) >= 0) pauses++;
    else chars++;
  }
  return chars / cps + pauses * 0.18;
}

// 与 build.mjs 同一套公式，只是把"实测语音时长"换成"预估语音时长"
let acc = 0;
const segments = cfg.segments.map(s => {
  const audio = estimateAudio(s.text);
  const dur = Math.max(cfg.minDur, cfg.lead + audio + cfg.tail);
  const seg = { id: s.id, start: +acc.toFixed(4), dur: +dur.toFixed(4), audio: +audio.toFixed(2), text: s.text };
  acc += dur;
  return seg;
});
const total = +acc.toFixed(4);
const timeline = { fps: cfg.fps, segments: segments.map(s => ({ id: s.id, start: s.start, dur: s.dur })) };

console.log('项目: ' + PROJECT);
console.log('预估时间轴（真实时长以 TTS 实测为准）');
console.log('  #  场景 id        起  时长   预估语音  比例');
for (let i = 0; i < segments.length; i++) {
  const s = segments[i];
  console.log('  ' + (i + 1) + '  ' + s.id.padEnd(14) + String(s.start.toFixed(2)).padStart(6) +
    String(s.dur.toFixed(2)).padStart(7) + String(s.audio.toFixed(2)).padStart(9) +
    String((s.dur / total * 100).toFixed(0) + '%').padStart(7));
}
console.log('  合计 ' + total.toFixed(2) + 's -> ' + Math.round(total * cfg.fps) + ' 帧 @' + cfg.fps + 'fps');
const bad = segments.filter(s => s.audio > s.dur);
if (bad.length) console.log('  注意：' + bad.map(s => s.id).join('/') + ' 的文案偏长，语音可能顶满整段');
if (cfg.segments.length !== segments.length) console.log('  注意：场景数与旁白段数不一致');

if (argv.includes('--plan')) process.exit(0);

// 机器上可能并存多个 playwright-core，逐个尝试，用第一台浏览器真能启动的
function playwrightCandidates() {
  const tried = [];
  const push = p => { if (p && tried.indexOf(p) === -1) tried.push(p); };
  if (process.env.PW_CORE) push(process.env.PW_CORE);
  for (const base of [PROJECT, HERE, process.cwd()]) {
    try { push(req.resolve('playwright-core', { paths: [base] })); } catch (e) {}
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
        .filter(d => d.indexOf('playwright-core@') === 0)
        .sort((a, b) => ((a.indexOf('alpha') >= 0 ? 1 : 0) - (b.indexOf('alpha') >= 0 ? 1 : 0)) || a.localeCompare(b));
      for (const d of dirs) push(path.join(root, d, 'node_modules/playwright-core'));
    } catch (e) {}
  }
  return tried.filter(p => fs.existsSync(p));
}

async function launchChromium() {
  const cands = playwrightCandidates();
  if (!cands.length) throw new Error('找不到 playwright-core，请用环境变量 PW_CORE 指向其安装目录');
  let lastErr = null;
  for (const cand of cands) {
    try {
      const { chromium } = require(cand);
      const browser = await chromium.launch();
      console.log('chromium', cand);
      return browser;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('没有可用的 playwright-core');
}

function shotsFor(seg, shots) {
  const out = [];
  for (let j = 0; j < shots; j++) out.push(+(seg.start + seg.dur * (0.25 + 0.5 * (shots === 1 ? 0.5 : j / (shots - 1)))).toFixed(3));
  return out;
}

(async () => {
  const atIdx = argv.indexOf('--at');
  const shotsIdx = argv.indexOf('--shots');
  const shots = shotsIdx >= 0 ? Math.max(1, parseInt(argv[shotsIdx + 1], 10) || 2) : 2;
  let queue;   // [{ t, name }]
  if (atIdx >= 0) {
    queue = argv.slice(atIdx + 1).map(Number).filter(n => isFinite(n))
      .map((t, i) => ({ t, name: '抽帧_' + String(i + 1).padStart(2, '0') + '_' + t + 's' }));
  } else {
    queue = [];
    segments.forEach((seg, i) => {
      shotsFor(seg, shots).forEach(t => {
        queue.push({ t, name: '场景' + String(i + 1).padStart(2, '0') + '_' + seg.id + '_' + t + 's' });
      });
    });
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.addInitScript(tl => { window.__VM = tl; }, timeline);   // 用预估时间轴渲染
  await page.goto('file://' + path.join(PROJECT, 'animation.html'));
  await page.waitForFunction('window.__ready === true');
await page.evaluate(() => document.fonts.ready);   // 等 KaTeX 字体就绪，否则首帧会用 fallback 字体
  console.log('页面 meta:', JSON.stringify(await page.evaluate(() => window.__meta)));

  for (const item of queue) {
    await page.evaluate(t => window.__seek(t), item.t);
    const out = path.join(SHOT_DIR, item.name + '.png');
    await page.screenshot({ path: out });
    console.log('已输出 ' + path.relative(PROJECT, out));
  }
  if (errs.length) console.log('页面错误 ' + JSON.stringify(errs));
  else console.log('页面无错误');
  await browser.close();
  console.log('请人工审核这些分镜与 animation.html；确认后再执行 node build.mjs --approved');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
