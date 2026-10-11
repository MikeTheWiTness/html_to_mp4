// 阶段二/三·统一体检入口：公式与排版（qa-katex） + 画面（qa-frames）。
//
//   node qa.cjs            两项都跑，汇总成 work/qa/report.json
//   node qa.cjs --static   只跑 qa-katex --static（没有浏览器也能做的部分）
//   node qa.cjs --strict   子脚本加 --strict，warn 也算失败
//   node qa.cjs --json     只打印汇总 JSON
//
// 这是出片闸门的一部分：build.mjs --approved 默认要求 work/qa/report.json 存在且 ok。
// 退出码：0 = 通过；1 = 有 error（或子脚本崩溃）。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const STATIC_ONLY = argv.includes('--static');
const STRICT = argv.includes('--strict');
const NL = String.fromCharCode(10);

function resolveProject() {
  for (const d of [process.cwd(), HERE]) {
    if (fs.existsSync(path.join(d, 'script.json'))) return d;
  }
  return HERE;
}
const PROJECT = resolveProject();
const QA_DIR = path.join(PROJECT, 'work', 'qa');

function runChild(name, extra) {
  const local = path.join(HERE, name);
  const script = fs.existsSync(local) ? local : path.join(PROJECT, name);
  if (!fs.existsSync(script)) return { script: name, code: 127, missing: true };
  const result = spawnSync(process.execPath, [script].concat(extra), {
    cwd: PROJECT,
    stdio: AS_JSON ? 'ignore' : 'inherit'
  });
  return { script: name, code: typeof result.status === 'number' ? result.status : 1 };
}

function readReport(name) {
  try { return JSON.parse(fs.readFileSync(path.join(QA_DIR, name), 'utf8')); }
  catch (e) { return null; }
}

(function () {
  if (!fs.existsSync(path.join(PROJECT, 'script.json'))) {
    console.error('缺少 ' + path.join(PROJECT, 'script.json') + '：请把 qa.cjs 放进项目目录，或指向真正的项目。');
    process.exit(1);
  }
  fs.mkdirSync(QA_DIR, { recursive: true });

  const strictArgs = STRICT ? ['--strict'] : [];
  const steps = [];
  steps.push(runChild('qa-katex.cjs', STATIC_ONLY ? ['--static'].concat(strictArgs) : strictArgs));
  if (!STATIC_ONLY) steps.push(runChild('qa-frames.cjs', strictArgs));

  const katex = readReport('katex.json');
  const frames = STATIC_ONLY ? null : readReport('frames.json');
  const katexOk = Boolean(katex && katex.ok);
  const framesOk = STATIC_ONLY ? true : Boolean(frames && frames.ok);
  const childCrashed = steps.some(function (s) { return s.missing || (s.code !== 0 && s.code !== 1); });
  const ok = katexOk && framesOk && !childCrashed;

  const report = {
    schema: 1,
    project: PROJECT,
    generatedAt: new Date().toISOString(),
    staticOnly: STATIC_ONLY,
    strict: STRICT,
    ok: ok,
    steps: steps,
    katex: katex ? { ok: katex.ok, summary: katex.summary, errors: (katex.findings || []).filter(function (f) { return f.level === 'error'; }), keys: (katex.findings || []).filter(function (f) { return f.level === 'warn'; }).map(function (f) { return f.code; }) } : null,
    frames: frames ? { ok: frames.ok, summary: frames.summary, timeline: frames.timeline, errors: (frames.findings || []).filter(function (f) { return f.level === 'error'; }), keys: (frames.findings || []).filter(function (f) { return f.level === 'warn'; }).map(function (f) { return f.code; }) } : null
  };
  fs.writeFileSync(path.join(QA_DIR, 'report.json'), JSON.stringify(report, null, 2) + NL);

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + NL);
  } else {
    const lines = [];
    lines.push('');
    lines.push('出片前体检汇总  ' + PROJECT);
    lines.push('  公式与排版  ' + (katex ? (katexOk ? '✓ 通过' : '✗ 有 error') : '✗ 没有产出报告') + '  (error ' + (katex ? katex.summary.errors : '?') + ' / warn ' + (katex ? katex.summary.warns : '?') + ')');
    if (!STATIC_ONLY) lines.push('  画面        ' + (frames ? (framesOk ? '✓ 通过' : '✗ 有 error') : '✗ 没有产出报告') + '  (error ' + (frames ? frames.summary.errors : '?') + ' / warn ' + (frames ? frames.summary.warns : '?') + '，抽帧 ' + (frames ? frames.summary.samples : '?') + ' 张)');
    else lines.push('  画面        - （--static 跳过）');
    for (const s of steps) if (s.missing) lines.push('  ! 找不到子脚本 ' + s.script);
    lines.push('  报告 work/qa/report.json');
    if (!ok) lines.push('  → 修掉上面的 error 再跑一次；出片闸门要求 report.json.ok = true');
    process.stdout.write(lines.join(NL) + NL);
  }
  process.exit(ok ? 0 : 1);
})();

