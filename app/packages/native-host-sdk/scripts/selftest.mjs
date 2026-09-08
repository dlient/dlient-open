/**
 * native-host-sdk 自检（N4 验收）：官方 Node 起 example-host，验证
 *  - 普通 RPC echo（length-prefixed 帧）
 *  - 错误 RPC（{ ok:false, error }）
 *  - 流式输出（AsyncIterable → 逐块 more:true）
 *  - 事件推送（host.emit → client.onEvent）
 *  - host 崩溃 → 挂起请求 reject（不留悬挂 Promise）
 *  - --ndjson 调试模式往返一致
 * 运行：node scripts/selftest.mjs
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeHostClient } from '../dist/index.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist/example-host.mjs')

let failures = 0
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

async function runCase(ndjson) {
  const label = ndjson ? 'ndjson' : 'length-prefixed'
  console.log(`\n[${label}]`)
  const proc = spawn(process.execPath, ndjson ? [entry, '--ndjson'] : [entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const client = createNativeHostClient({ proc, ndjson, timeoutMs: 5000, heartbeatTimeoutMs: 2000 })

  // 1) echo
  const echoed = await client.call('echo', 'echo', [{ hello: 'native-host' }, 42])
  check(`${label} echo 往返`, JSON.stringify(echoed) === JSON.stringify([{ hello: 'native-host' }, 42]), JSON.stringify(echoed))

  // 2) 错误 RPC → reject
  let errMsg = ''
  try {
    await client.call('echo', 'fail', [])
  } catch (e) {
    errMsg = e.message
  }
  check(`${label} 错误 RPC reject`, /boom from native-host/.test(errMsg), errMsg)

  // 3) 流式输出（5 块）
  const chunks = []
  const stream = client.stream('stream', 'numbers', [5])
  await new Promise((resolve, reject) => {
    stream.onData((c) => chunks.push(c))
    stream.onDone(() => resolve())
    stream.onError((e) => reject(e))
  })
  check(`${label} 流式 5 块`, chunks.length === 5 && chunks[4].i === 5 && chunks[4].value === 25, `chunks=${chunks.length}`)

  // 4) 事件推送
  const evP = new Promise((resolve) => client.onEvent('pong', (d) => resolve(d)))
  await client.call('echo', 'notify', [])
  const ev = await evP
  check(`${label} 事件推送`, ev && typeof ev.ts === 'number', JSON.stringify(ev))

  client.dispose()
  await new Promise((resolve) => proc.once('close', resolve))
}

// 5) host 崩溃 → 挂起请求 reject
async function runCrashCase() {
  console.log('\n[crash]')
  const proc = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const client = createNativeHostClient({ proc, timeoutMs: 0, heartbeatTimeoutMs: 2000 })
  // 先挂 close 监听再杀进程（避免 kill 后 close 已触发导致监听注册太晚挂起）
  const closed = new Promise((resolve) => proc.once('close', resolve))
  // 发一个不存在的 service 触发 pending，然后立刻杀进程
  const pending = client.call('echo', 'never', [])
  proc.kill()
  let rejected = false
  try {
    await pending
  } catch (e) {
    rejected = /异常退出|disposed/.test(e.message)
  }
  check('崩溃 reject 挂起请求', rejected)
  client.dispose()
  await closed
}

try {
  await runCase(false)
  await runCase(true)
  await runCrashCase()
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
} catch (err) {
  console.error('selftest crashed:', err)
  process.exit(1)
}
