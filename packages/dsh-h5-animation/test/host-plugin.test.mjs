/**
 * 宿主半侧（tools/index.js）的单元测试：用假的 ctx 走一遍注册与调用契约。
 *
 * 不启动真实 DSH：只锁定工具名、schema、argv 组装、cwd/env 注入与错误路径，
 * 真实宿主行为见 host-probe/README.md。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply, inject, name as pluginName } from '../tools/index.js'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(PKG, 'tools', 'cli.mjs')

function reader(text) {
  return { readFrom: () => ({ text, lossy: false }) }
}

function fakeCtx({ nodePath = process.execPath, spawnCapture } = {}) {
  const state = { registered: null }
  const ctx = {
    get: () => undefined,
    tools: { register: (definition) => { state.registered = definition } },
    subprocess: {
      resolveExecutable: async (command) => (command === 'node' || command === nodePath ? nodePath : null),
      spawn: (options) => {
        if (spawnCapture) spawnCapture(options)
        return {
          done: Promise.resolve({ exitCode: 0 }),
          collected: { stdout: reader('check-env ok'), stderr: reader('') },
        }
      },
    },
  }
  return { ctx, state }
}

function sessionExec(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('插件导出名与注入服务符合宿主约定', () => {
  assert.equal(pluginName, 'h5-animation-tools')
  assert.deepEqual(inject, ['tools', 'subprocess'])
  assert.equal(typeof apply, 'function')
})

test('注册出 h5video 工具，schema 与返回结构完整', () => {
  const { ctx, state } = fakeCtx()
  apply(ctx, {})
  const tool = state.registered
  assert.equal(tool.name, 'h5video')
  assert.ok(tool.description.includes('check-env'))
  assert.ok(tool.description.includes('--approved'))
  assert.deepEqual(tool.parameters.required, ['args'])
  assert.equal(tool.parameters.properties.args.type, 'array')
  assert.deepEqual(tool.output.schema.required, ['exitCode', 'stdout', 'stderr', 'truncated'])
  assert.equal(typeof tool.execute, 'function')
  assert.equal(typeof tool.output.render, 'function')
  assert.ok(tool.timeoutMs >= 60000)
})

test('render 把退出码与两路输出拼成可读文本', () => {
  const { ctx, state } = fakeCtx()
  apply(ctx, {})
  const rendered = state.registered.output.render({ args: ['check-env'] }, { exitCode: 2, stdout: 'out', stderr: 'err', truncated: true })
  assert.equal(rendered[0].type, 'text')
  assert.ok(rendered[0].text.includes('$ h5video check-env'))
  assert.ok(rendered[0].text.includes('exitCode: 2'))
  assert.ok(rendered[0].text.includes('已截断'))
  assert.ok(rendered[0].text.includes('--- stdout ---'))
  assert.ok(rendered[0].text.includes('--- stderr ---'))
})

test('argv 原样透传，cwd 取会话工作区，并注入 H5VIDEO_* 变量', async () => {
  const workRoot = fs.realpathSync(os.tmpdir())
  let captured = null
  const { ctx, state } = fakeCtx({ spawnCapture: (options) => { captured = options } })
  apply(ctx, { toolsDir: '/opt/tools' })
  const tool = state.registered
  const value = await tool.execute({ args: ['plan', 'proj'] }, sessionExec(workRoot))
  assert.deepEqual(captured.argv, [process.execPath, CLI, 'plan', 'proj'])
  assert.equal(captured.cwd, workRoot)
  assert.equal(captured.env.H5VIDEO_WORK_ROOT, workRoot)
  assert.equal(captured.env.H5VIDEO_TOOLS_DIR, '/opt/tools')
  assert.equal(value.exitCode, 0)
  assert.equal(value.stdout, 'check-env ok')
  assert.equal(value.truncated, false)
})

test('空 args、缺工作区、cwd 不一致都明确报错', async () => {
  const workRoot = fs.realpathSync(os.tmpdir())
  const { ctx, state } = fakeCtx()
  apply(ctx, {})
  const tool = state.registered
  await assert.rejects(() => tool.execute({ args: [] }, sessionExec(workRoot)), /args 不能为空/)
  await assert.rejects(() => tool.execute({ args: ['check-env'] }, { agent: { session: { header: {} } } }), /缺少绝对工作区路径/)
  await assert.rejects(() => tool.execute({ args: ['check-env'], cwd: '/tmp' }, sessionExec(workRoot)), /cwd 必须等于当前会话工作区/)
})

test('用户取消时抛 AbortError，不伪装成普通失败', async () => {
  const workRoot = fs.realpathSync(os.tmpdir())
  const { ctx, state } = fakeCtx()
  apply(ctx, {})
  const tool = state.registered
  await assert.rejects(
    () => tool.execute({ args: ['check-env'] }, { ...sessionExec(workRoot), signal: AbortSignal.abort() }),
    (error) => error.name === 'AbortError',
  )
})

test('找不到 node 时报可执行的错误，并提示 bash 退路', async () => {
  const workRoot = fs.realpathSync(os.tmpdir())
  const { ctx, state } = fakeCtx()
  ctx.subprocess.resolveExecutable = async () => null
  apply(ctx, {})
  const tool = state.registered
  await assert.rejects(() => tool.execute({ args: ['check-env'] }, sessionExec(workRoot)), /找不到 node 解释器[\s\S]*bash/)
})
