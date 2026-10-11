import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// H5 动画 -> MP4（含旁白）
//   1. say 合成中文旁白      2. ffprobe 量时长      3. 用语音时长反推画面时长
//   4. 无头 Chromium 逐帧定格截图                  5. ffmpeg 编码 H.264 + 混流
// 用法：node build.mjs --approved [--reuse-tts] [--keep-frames] [--skip-qa]
//
// 这是【第二阶段】。第一阶段先用 node storyboard.cjs 出分镜、把 animation.html 交给
// 人审核；没有 --approved 就拒绝出片，避免一步到位、画面未经确认就生成视频。
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));   // 脚本自身所在目录
const NL = String.fromCharCode(10);

// 项目目录：优先用"当前工作目录"，其次脚本自身目录。
// 这样既支持把脚本复制进项目（node build.mjs），也支持从 templates/ 直接跑
// （node ../../templates/build.mjs --approved）。
function resolveProject() {
  for (const d of [process.cwd(), HERE]) {
    if (fsSync.existsSync(path.join(d, 'script.json'))) return d;
  }
  return HERE;
}
const PROJECT = resolveProject();
const REUSE_TTS = process.argv.includes('--reuse-tts');

if (!process.argv.includes('--approved')) {
  console.error([
    '',
    '尚未审核通过，已停止。',
    '',
    '  第一步：node storyboard.cjs          出分镜图 + 预估时间轴',
    '          并在浏览器里打开 animation.html 直接看动画',
    '  第二步：把分镜图和动画交给需求方确认，按反馈改画面 / 改旁白，重复第一步',
    '  第三步：确认无误后执行：',
    '          node build.mjs --approved',
    ''
  ].join(NL));
  process.exit(2);
}

const cfg = JSON.parse(await fs.readFile(path.join(PROJECT, 'script.json'), 'utf8'));
const WORK = path.join(PROJECT, 'work');
const FRAMES = path.join(WORK, 'frames');
const OUT = path.join(PROJECT, 'out');

// 0. 出片前的画面体检闸门：阶段二/三固定先跑 node qa.cjs，
//    要求 work/qa/report.json 存在且 ok。要看未经体检的旧画面时才显式 --skip-qa。
if (!process.argv.includes('--skip-qa')) {
  let qaReport = null;
  try { qaReport = JSON.parse(fsSync.readFileSync(path.join(WORK, 'qa', 'report.json'), 'utf8')); } catch (e) { /* 没跑过 qa */ }
  if (!qaReport || qaReport.ok !== true) {
    console.error([
      '',
      '尚未通过画面体检，已停止。',
      '',
      '  先执行：node qa.cjs        # 公式与排版 + 抽帧画面体检，产物在 work/qa/',
      '  按报告修掉 error 再出片；确实要跳过就显式加 --skip-qa。',
      ''
    ].join(NL));
    process.exit(2);
  }
  log('画面体检  ', 'work/qa/report.json ok');
} else {
  log('画面体检  ', '已用 --skip-qa 跳过（成片未经 qa 核查，风险自负）');
}

function firstExisting(list) {
  for (const p of list) { if (p && fsSync.existsSync(p)) return p; }
  return null;
}

function resolveFfmpeg(name) {
  const env = process.env[name.toUpperCase()];
  if (env) return env;
  const local = [
    path.join(PROJECT, 'tools', name),
    path.join(PROJECT, 'node_modules', name + '-static', name),
    path.join(PROJECT, '..', 'tools', name),
    path.join(HERE, 'tools', name),
    path.join(HERE, '..', 'tools', name)
  ];
  if (name === 'ffprobe') {
    local.push(
      path.join(PROJECT, 'node_modules/ffprobe-static/bin/darwin/arm64/ffprobe'),
      path.join(PROJECT, 'node_modules/ffprobe-static/bin/darwin/x64/ffprobe'),
      path.join(PROJECT, 'node_modules/ffprobe-static/bin/linux/x64/ffprobe')
    );
  }
  return firstExisting(local) || name;   // 最后回退到 PATH
}

// 机器上往往并存多个 playwright-core（不同版本要求的 Chromium 版本不同）。
// 这里返回候选列表，逐个尝试直到有一台的浏览器真的能启动。
function playwrightCandidates() {
  const tried = [];
  const push = p => { if (p && tried.indexOf(p) === -1) tried.push(p); };
  if (process.env.PW_CORE) push(process.env.PW_CORE);
  for (const base of [PROJECT, HERE, process.cwd()]) {
    try { push(require.resolve('playwright-core', { paths: [base] })); } catch (e) {}
  }
  push(path.join(PROJECT, 'node_modules/playwright-core'));
  push(path.join(HERE, 'node_modules/playwright-core'));
  const roots = (process.env.PW_PNPM_ROOTS || '').split(':').filter(Boolean);
  roots.push(path.join(PROJECT, 'node_modules/.pnpm'));
  roots.push(path.join(HERE, 'node_modules/.pnpm'));
  roots.push(path.join(os.homedir(), 'deepseek-harness/deepseek-harness/node_modules/.pnpm'));
  for (const root of roots) {
    try {
      const dirs = fsSync.readdirSync(root)
        .filter(d => d.indexOf('playwright-core@') === 0)
        .sort((a, b) => ((a.indexOf('alpha') >= 0 ? 1 : 0) - (b.indexOf('alpha') >= 0 ? 1 : 0)) || a.localeCompare(b));
      for (const d of dirs) push(path.join(root, d, 'node_modules/playwright-core'));
    } catch (e) {}
  }
  return tried.filter(p => fsSync.existsSync(p));
}

async function launchChromium() {
  const cands = playwrightCandidates();
  if (!cands.length) throw new Error('找不到 playwright-core，请用环境变量 PW_CORE 指向其安装目录');
  let lastErr = null;
  for (const cand of cands) {
    try {
      const { chromium } = require(cand);
      const browser = await chromium.launch({ args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
      log('chromium  ', cand);
      return browser;
    } catch (e) {
      lastErr = e;
      log('  跳过 ' + cand + '：' + String(e.message).split('\n')[0]);
    }
  }
  throw lastErr || new Error('没有可用的 playwright-core');
}

const FFMPEG = resolveFfmpeg('ffmpeg');
const FFPROBE = resolveFfmpeg('ffprobe');


function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: PROJECT, ...opts });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(cmd + ' exited ' + code + NL + err.split(NL).slice(-12).join(NL)));
    });
  });
}
async function duration(file) {
  const r = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const v = parseFloat(r.out.trim());
  if (!isFinite(v)) throw new Error('读不到时长: ' + file);
  return v;
}
function log(...a) { console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a); }

log('项目目录  ', PROJECT);
log('ffmpeg    ', FFMPEG);
log('ffprobe   ', FFPROBE);

await fs.mkdir(WORK, { recursive: true });
await fs.mkdir(OUT, { recursive: true });
await fs.rm(FRAMES, { recursive: true, force: true });
await fs.mkdir(FRAMES, { recursive: true });

// 1. 旁白 -> 每段 wav（前补 lead、后补 tail，并截断到 segDur）
const segs = [];
for (let i = 0; i < cfg.segments.length; i++) {
  const s = cfg.segments[i];
  const aiff = path.join(WORK, 'seg' + i + '.aiff');
  const wav = path.join(WORK, 'seg' + i + '.wav');
  const hasAiff = fsSync.existsSync(aiff);
  if (!(REUSE_TTS && hasAiff)) {
    log('TTS seg' + i, JSON.stringify(s.text));
    await run('say', ['-v', cfg.voice, '-r', String(cfg.rate), '-o', aiff, s.text]);
  }
  const audioDur = await duration(aiff);
  const segDur = Math.max(cfg.minDur, cfg.lead + audioDur + cfg.tail);
  const leadMs = Math.round(cfg.lead * 1000);
  await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', aiff,
    '-af', 'adelay=' + leadMs + '|' + leadMs + ',apad', '-t', segDur.toFixed(3),
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', wav]);
  segs.push({ id: s.id, text: s.text, audioDur, dur: segDur, wav });
  log('  语音 ' + audioDur.toFixed(2) + 's -> 画面 ' + segDur.toFixed(2) + 's');
}

// 2. 时间轴
let acc = 0;
const timeline = { fps: cfg.fps, segments: [] };
for (const s of segs) {
  timeline.segments.push({ id: s.id, start: +acc.toFixed(4), dur: +s.dur.toFixed(4) });
  acc += s.dur;
}
const total = +acc.toFixed(4);
const totalFrames = Math.round(total * cfg.fps);
log('总时长', total.toFixed(2) + 's', '共', totalFrames, '帧 @' + cfg.fps + 'fps');

// 3. 拼接完整旁白轨
const listPath = path.join(WORK, 'audio-list.txt');
await fs.writeFile(listPath, segs.map(s => "file '" + s.wav + "'").join(NL) + NL);
const narration = path.join(WORK, 'narration.wav');
await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', narration]);
log('旁白轨', (await duration(narration)).toFixed(2) + 's');

// 4. 逐帧定格录制
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 });
await page.addInitScript(tl => { window.__VM = tl; }, timeline);
await page.goto('file://' + path.join(PROJECT, 'animation.html'));
await page.waitForFunction('window.__ready === true');
await page.evaluate(() => document.fonts.ready);   // 等 KaTeX 字体就绪，否则首帧会用 fallback 字体
log('开始录制 ...');
const t0 = Date.now();
for (let f = 0; f < totalFrames; f++) {
  await page.evaluate(t => window.__seek(t), f / cfg.fps);
  await page.screenshot({ path: path.join(FRAMES, String(f).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 95 });
  if (f % 120 === 0 || f === totalFrames - 1) {
    log('  帧 ' + f + '/' + totalFrames + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
await browser.close();
log('录制完成', ((Date.now() - t0) / 1000).toFixed(1) + 's');

// 5. 编码 H.264（先出无音轨中间件）
const silent = path.join(WORK, 'video.mp4');
log('编码 H.264 ...');
await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(cfg.fps),
  '-start_number', '0', '-i', path.join(FRAMES, '%05d.jpg'),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', silent]);

// 6. 混流旁白
const finalPath = path.join(OUT, cfg.output || 'video.mp4');
log('混流旁白 ...');
await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', silent, '-i', narration,
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', finalPath]);

await fs.writeFile(path.join(WORK, 'timeline.json'),
  JSON.stringify({ ...timeline, total, totalFrames, output: finalPath }, null, 2) + NL);

// 中间帧很占地方（上千张 JPEG，动辄 100MB+），出片成功后默认清掉；要复查就加 --keep-frames
if (process.argv.includes('--keep-frames')) {
  log('保留中间帧:', FRAMES);
} else {
  await fs.rm(FRAMES, { recursive: true, force: true });
}
log('完成 ->', finalPath);
log('体积', ((await fs.stat(finalPath)).size / 1048576).toFixed(2) + ' MB');
