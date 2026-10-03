#!/usr/bin/env node
/**
 * 把仓库根目录的 skill 同步成随包副本 skills/h5-animation-video。
 *
 * 随包 skill 是**生成物**：只允许由本脚本产出，不要手工改副本——
 * 改了会被 `--check`（和打包契约测试）当场抓出来。
 *
 *    node scripts/sync-skill.mjs            # 同步（新增/更新，并清掉副本里的多余文件）
 *    node scripts/sync-skill.mjs --check    # 只校验一致性，退出码非 0 表示有漂移
 *
 * 不随包的文件（体积或性质不合适）：
 *   tools/ffmpeg、tools/ffprobe   静态二进制，共 100MB+，按需用 tools/install-tools.sh 获取
 *   outputs/、_dsh-archive/       工作区产物与历史归档，不是 skill 本体
 *   packages/                    插件包自身，避免自引用
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))          // <包>/scripts
const PKG = path.dirname(HERE)                                      // <包>
const REPO = path.resolve(HERE, '..', '..', '..')                   // 仓库根
const DEST = path.join(PKG, 'skills', 'h5-animation-video')

/** 顶层直接收录的文件与目录；目录内部再按文件名过滤。 */
const INCLUDE_FILES = ['SKILL.md', 'README.md']
const INCLUDE_DIRS = ['references', 'templates', 'examples', 'tools']

/** 不随包的相对路径（相对仓库根）。 */
export const EXCLUDED = [
  'tools/ffmpeg',
  'tools/ffprobe',
  'outputs',
  '_dsh-archive',
  'packages',
  'node_modules',
  '.git',
]

function isExcluded(rel) {
  for (const item of EXCLUDED) {
    if (rel === item || rel.startsWith(item + '/')) return true
  }
  return false
}

/** 遍历时只忽略 DSH/Finder 元数据；源侧的 EXCLUDED 由 collectSourceFiles 决定。 */
function isNoise(rel) {
  return path.basename(rel) === '.DS_Store'
}

function walk(abs, rel, out) {
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel ? rel + '/' + entry.name : entry.name
    if (isNoise(childRel)) continue
    const childAbs = path.join(abs, entry.name)
    if (entry.isDirectory()) walk(childAbs, childRel, out)
    else if (entry.isFile()) out.set(childRel, childAbs)
    else if (entry.isSymbolicLink()) out.set(childRel, childAbs)
  }
}

/** 采集「应该随包」的文件集合：relPath -> 绝对路径。 */
export function collectSourceFiles(root = REPO) {
  const files = new Map()
  for (const name of INCLUDE_FILES) {
    const abs = path.join(root, name)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && !isExcluded(name)) files.set(name, abs)
  }
  for (const dir of INCLUDE_DIRS) {
    const abs = path.join(root, dir)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory() || isExcluded(dir)) continue
    const found = new Map()
    walk(abs, dir, found)
    for (const [rel, file] of found) {
      if (!isExcluded(rel)) files.set(rel, file)
    }
  }
  return files
}

/** 采集副本里已有的文件集合（.DS_Store 一律忽略）。 */
export function collectDestFiles(dest = DEST) {
  const files = new Map()
  if (!fs.existsSync(dest)) return files
  walk(dest, '', files)
  return files
}

export function sameBytes(a, b) {
  try {
    const left = fs.readFileSync(a)
    const right = fs.readFileSync(b)
    return left.equals(right)
  } catch {
    return false
  }
}

/** 比较源与副本，返回 { missing, changed, extra }。 */
export function diff(source = collectSourceFiles(), dest = collectDestFiles()) {
  const missing = []
  const changed = []
  const extra = []
  for (const [rel, abs] of source) {
    const target = path.join(DEST, rel)
    if (!dest.has(rel)) missing.push(rel)
    else if (!sameBytes(abs, target)) changed.push(rel)
  }
  for (const rel of dest.keys()) {
    if (!source.has(rel)) extra.push(rel)
  }
  return { missing: missing.sort(), changed: changed.sort(), extra: extra.sort() }
}

function sync() {
  const source = collectSourceFiles()
  const dest = collectDestFiles()
  const created = [], updated = [], removed = []
  for (const [rel, abs] of source) {
    const target = path.join(DEST, rel)
    if (!dest.has(rel)) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(abs, target)
      fs.chmodSync(target, fs.statSync(abs).mode & 0o777)
      created.push(rel)
    } else if (!sameBytes(abs, target)) {
      fs.copyFileSync(abs, target)
      updated.push(rel)
    }
  }
  for (const rel of dest.keys()) {
    if (!source.has(rel)) {
      fs.rmSync(path.join(DEST, rel), { force: true })
      removed.push(rel)
    }
  }
  return { created: created.sort(), updated: updated.sort(), removed: removed.sort(), total: source.size }
}

function report(title, lines) {
  if (!lines.length) return
  console.log(title)
  for (const line of lines) console.log('  ' + line)
}

function main() {
  const check = process.argv.includes('--check')
  if (!fs.existsSync(path.join(REPO, 'SKILL.md'))) {
    console.error('找不到仓库根的 SKILL.md：' + REPO)
    process.exitCode = 1
    return
  }
  if (check) {
    const { missing, changed, extra } = diff()
    if (!missing.length && !changed.length && !extra.length) {
      console.log('随包 skill 与仓库源一致（' + collectSourceFiles().size + ' 个文件）')
      return
    }
    report('副本缺少：', missing)
    report('副本内容不一致：', changed)
    report('副本多余：', extra)
    console.error('随包 skill 与仓库源不一致，请运行：node scripts/sync-skill.mjs')
    process.exitCode = 1
    return
  }
  const result = sync()
  report('新增：', result.created)
  report('更新：', result.updated)
  report('删除：', result.removed)
  console.log('随包 skill 已同步：' + DEST + '（' + result.total + ' 个文件）')
  console.log('未随包：' + EXCLUDED.join('、'))
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
