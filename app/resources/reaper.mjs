/**
 * reaper.mjs — 子进程收割进程（宿主退出后杀掉宿主 spawn 的进程树）。
 *
 * 由宿主主进程懒启动（首个 spawn 时）并以 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 自带 Node，
 * 之后常驻复用（不再重复拉起）。生命周期与宿主进程绑定：
 *   - 控制通道 = stdin（宿主独占写端）：
 *       `R\t<pid>\t<createdAtMs>\t<image>`  登记一个宿主 spawn 的子进程
 *       `U\t<pid>`                          注销（该子进程已被回收/杀）
 *   - 宿主进程结束（正常退出 / 崩溃 / 被强杀）→ 管道关闭 → read EOF → 开始收割 → 自己退出。
 *
 * 收割策略（核心诉求：杀干净且**不误杀其它应用的进程**）：
 *   1. 取一次进程快照（pid / ppid / 创建时间 / 映像名）；
 *   2. 逐条登记：映像名匹配 **且** 快照里的创建时间与登记时刻接近（±10s）才认定为「同一个进程」
 *      → 杀整棵树（Windows `taskkill /T`；POSIX 杀掉进程组）。PID 被复用时创建时间必然对不上 → 跳过。
 *   3. 后代兜底：宿主被强杀时顶层进程常因管道断开（EPIPE）先退出，此时按父链把后代找出来清掉；
 *      每个后代还要求「创建时间不早于登记时刻」+ 映像名在白名单内，进一步避免误杀。
 * 快照不可用（无 PowerShell / ps）时退化为「按登记 pid 杀整树」，与宿主侧启动清扫的旧行为一致。
 *
 * 本文件必须放在 asar 之外（纯 node 进程不认 asar）：打包时经 electron-builder extraResources 复制。
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const isWin = process.platform === 'win32'
/** 「同一进程」判定：登记时刻与快照创建时间的最大偏差（PID 复用时必然远超此值） */
const SAME_PROCESS_TOLERANCE_MS = 10_000
/** 后代创建时间不得早于登记时刻（留 5s 时钟抖动余量） */
const DESCENDANT_SKEW_MS = 5_000
/** 后代清理的映像白名单（node 系 + esbuild；避免误杀编辑器等无关进程） */
const SWEEPABLE = new Set(['node', 'esbuild', 'npm', 'npx', 'pnpm'])
/** 收割结果日志（宿主注入；缺省只写内存不落盘） */
const LOG_PATH = process.env.DLIENT_REAPER_LOG || ''

function log(message) {
  if (!LOG_PATH) return
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    /* 日志失败不影响收割 */
  }
}

/** pid → 登记信息 */
const records = new Map()

// ---- 基础工具 ----

/** 跑一条命令并等它结束（返回是否成功；失败/异常都算 false） */
function run(cmd, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

/** 抓命令输出（带超时；失败返回 null） */
function runCapture(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false
    let timer
    const finish = (v) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(v)
    }
    try {
      const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      timer = setTimeout(() => {
        child.kill()
        finish(null)
      }, timeoutMs)
      let out = ''
      child.stdout?.on('data', (d) => (out += String(d)))
      child.on('error', () => finish(null))
      child.on('close', () => finish(out))
    } catch {
      finish(null)
    }
  })
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code !== 'ESRCH'
  }
}

async function waitGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return !isAlive(pid)
}

/** 杀整棵树：Windows `taskkill /T /F`；POSIX 杀进程组（宿主 spawn 时 detached=true，子进程即组长） */
async function killTree(pid) {
  if (isWin) return run('taskkill', ['/pid', String(pid), '/T', '/F'])
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* 已退出 */
    }
  }
  return true
}

/** 映像名比对（宽松：一致或互为前缀，兼容 Linux `comm` 15 字符截断；缺信息则不据此否决） */
function imageMatches(recorded, actual) {
  const a = String(recorded || '').toLowerCase().replace(/\.exe$/, '')
  const b = String(actual || '').toLowerCase().replace(/\.exe$/, '')
  if (!a || !b) return true
  return a === b || a.startsWith(b) || b.startsWith(a)
}

function isSweepable(image) {
  return SWEEPABLE.has(String(image || '').toLowerCase().replace(/\.exe$/, ''))
}

// ---- 进程快照 ----

/** Windows：CIM 取 pid/ppid/创建时间(ms)/映像名（制表符分隔，避免名称含空格时错位）。
 *  创建时间用「UTC ticks - 1970 基准」纯整数换算：不要用 DateTime 相减（跨 Kind 会差一个本地时区偏移）。 */
const WIN_SNAPSHOT_PS =
  'Get-CimInstance Win32_Process | ForEach-Object { $c=0; if ($_.CreationDate) { $c=[int64](($_.CreationDate.ToUniversalTime().Ticks - 621355968000000000) / 10000) }; "$($_.ProcessId)`t$($_.ParentProcessId)`t$c`t$($_.Name)" }'

/** POSIX：`ps` 的 etime（自进程启动经过的时间）反推创建时刻 */
function parseEtime(text) {
  const dash = String(text || '').trim().split('-')
  let days = 0
  let rest = dash[0]
  if (dash.length === 2) {
    days = Number(dash[0]) || 0
    rest = dash[1]
  }
  const t = rest.split(':').map((x) => Number(x) || 0)
  let h = 0
  let m = 0
  let s = 0
  if (t.length === 3) [h, m, s] = t
  else if (t.length === 2) [m, s] = t
  else if (t.length === 1) [s] = t
  return ((days * 24 + h) * 60 + m) * 60 + s
}

/** 快照：pid → { ppid, createdAt, image }；不可用返回 null */
async function snapshot() {
  const map = new Map()
  if (isWin) {
    const out = await runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', WIN_SNAPSHOT_PS])
    if (!out) return null
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split('\t')
      if (parts.length < 4) continue
      const pid = Number(parts[0])
      const ppid = Number(parts[1])
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
      map.set(pid, { ppid, createdAt: Number(parts[2]) || 0, image: parts[3].trim() })
    }
    return map.size > 0 ? map : null
  }
  const out = await runCapture('ps', ['-axo', 'pid=,ppid=,etime=,comm='])
  if (!out) return null
  const now = Date.now()
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!m) continue
    map.set(Number(m[1]), {
      ppid: Number(m[2]),
      createdAt: now - parseEtime(m[3]) * 1000,
      image: m[4].trim(),
    })
  }
  return map.size > 0 ? map : null
}

/** 按父链求 root 的全部后代（含多级；root 已退出也能追到孙进程） */
function descendants(root, snap) {
  const childrenOf = new Map()
  for (const [pid, info] of snap) {
    const arr = childrenOf.get(info.ppid)
    if (arr) arr.push(pid)
    else childrenOf.set(info.ppid, [pid])
  }
  const out = []
  const seen = new Set([root])
  const queue = [root]
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const child of childrenOf.get(cur) || []) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

// ---- 收割 ----

/** 登记信息与快照条目是否指向同一个进程（映像名 + 创建时间双校验） */
function sameProcess(info, rec) {
  if (!imageMatches(rec.image, info.image)) return false
  if (!info.createdAt || !rec.createdAt) return true
  return Math.abs(info.createdAt - rec.createdAt) <= SAME_PROCESS_TOLERANCE_MS
}

async function reap() {
  if (records.size === 0) {
    log('host gone: no child recorded, nothing to reap')
    return
  }
  const snap = await snapshot()
  log(`snapshot: ${snap ? snap.size : 0} process(es)${snap ? '' : ' (unavailable)'}`)
  let killed = 0
  for (const [pid, rec] of records) {
    if (!snap) {
      // 无快照能力：退回「按登记 pid 杀整树」（旧行为）
      if (isAlive(pid) && (await killTree(pid))) killed++
      continue
    }
    const self = snap.get(pid)
    if (self && sameProcess(self, rec)) {
      const ok = await killTree(pid)
      await waitGone(pid, 3000)
      if (ok) killed++
      log(`reap tree pid=${pid} image=${self.image} ok=${ok}`)
      continue
    }
    log(
      `root pid=${pid} not matched (snap=${self ? `${self.image}/${self.createdAt}` : 'gone'}, rec=${rec.image}/${rec.createdAt})`,
    )
    // 登记进程已不在（或被 PID 复用）：改清它的后代 —— 宿主强杀时顶层进程常先 EPIPE 退出
    for (const child of descendants(pid, snap)) {
      const info = snap.get(child)
      if (!info || !isSweepable(info.image)) continue
      if (info.createdAt && info.createdAt < rec.createdAt - DESCENDANT_SKEW_MS) continue
      if (await killTree(child)) killed++
      log(`reap descendant pid=${child} image=${info.image}`)
    }
  }
  log(`host gone: reaped ${killed} process(es) from ${records.size} record(s)`)
}

// ---- 控制通道 ----

function handleLine(line) {
  const parts = String(line).split('\t')
  const cmd = parts[0]
  const pid = Number(parts[1])
  if (!Number.isFinite(pid) || pid <= 0) return
  if (cmd === 'R') {
    records.set(pid, { createdAt: Number(parts[2]) || 0, image: parts[3] || '' })
  } else if (cmd === 'U') {
    records.delete(pid)
  }
}

let finished = false
function finish() {
  if (finished) return
  finished = true
  log(`stdin closed (host exited); reaping ${records.size} record(s)`)
  void reap().finally(() => process.exit(0))
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  for (;;) {
    const i = buf.indexOf('\n')
    if (i < 0) break
    handleLine(buf.slice(0, i))
    buf = buf.slice(i + 1)
  }
})
process.stdin.on('end', finish)
process.stdin.on('close', finish)
process.stdin.on('error', finish)

log(`reaper started pid=${process.pid}`)
