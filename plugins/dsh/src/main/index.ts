/**
 * dsh worker 入口（src/main/index.ts）。
 *
 * 目标：在 dlient 中运行 DeepSeek Harness（dsh）的 web UI。
 * 流程：经 nodejs host-api 解析 Node.js 运行时（内置 LTS 优先 → PATH 本地 → 自动安装内置）→
 *       （未安装时）npm 全局安装 @deepseek-ai/dsh →
 *       用 node:net 分配空闲端口 → 启动 `dsh web --no-open --host 127.0.0.1 --port <port>` →
 *       探测端口就绪 → 把 URL 交给渲染端。
 * 渲染端用 @dlient-open/ui 的 Webview 组件（经本 worker 内建 webview:* 转发）加载该 URL。
 */

import { createWorkerRpc } from '@dlient-open/plugin-sdk'
import type { ChildHandle } from '@dlient-open/plugin-sdk'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const rpc = createWorkerRpc('dsh')

// ---- worker 端 i18n：经宿主 i18n.getLocale 查询当前语言，按语言拼装用户可见文案 ----
type DshLocale = 'zh-CN' | 'en-US'
const DSH_MSG: Record<DshLocale, Record<string, (p?: Record<string, string | number>) => string>> = {
  'zh-CN': {
    execFailed: (p) => `命令失败（exit ${p?.code}）：${p?.err ?? ''}`,
    nodeMissing: () => '无法获取 Node.js 运行时（内置 LTS 安装失败或不可用）',
    npmGlobalMissing: () => '无法定位 npm 全局目录（npm root -g 无输出）',
    npmInstallFailed: (p) => `npm install 失败（exit ${p?.code}）: ${p?.out ?? ''}`,
    binMissing: () => '@deepseek-ai/dsh 包缺少 bin 入口',
  },
  'en-US': {
    execFailed: (p) => `Command failed (exit ${p?.code}): ${p?.err ?? ''}`,
    nodeMissing: () => 'Cannot resolve the Node.js runtime (built-in LTS install failed or unavailable)',
    npmGlobalMissing: () => 'Cannot locate the global npm directory (npm root -g returned nothing)',
    npmInstallFailed: (p) => `npm install failed (exit ${p?.code}): ${p?.out ?? ''}`,
    binMissing: () => 'The @deepseek-ai/dsh package is missing its bin entry',
  },
}
let dshLocale: DshLocale = 'zh-CN'
async function queryDshLocale(): Promise<DshLocale> {
  try {
    const l = (await rpc.i18n.getLocale()) as DshLocale
    dshLocale = l === 'en-US' || l === 'zh-CN' ? l : 'zh-CN'
  } catch {
    /* 保留上次语言 */
  }
  return dshLocale
}
async function dmsg(key: string, params?: Record<string, string | number>): Promise<string> {
  const loc = await queryDshLocale()
  return (DSH_MSG[loc][key] ?? DSH_MSG['zh-CN'][key])(params)
}

/** 对外状态（渲染端经 dsh.status / push 'dsh.status' 消费） */
interface DshStatus {
  phase: 'idle' | 'checking-node' | 'installing-dsh' | 'starting' | 'ready' | 'error'
  url?: string
  error?: string
  /** 是否启动过：stop 后为 true，渲染端据此区分「从未启动（自动启动）」与「已停止（不自动重启）」 */
  startedOnce?: boolean
}

/** 宿主代管子进程句柄（child.spawn 拉起 dsh web；kill 即整树回收） */
let child: ChildHandle | null = null
let current: DshStatus = { phase: 'idle' }

function pushStatus(s: DshStatus): void {
  current = s
  rpc.push('dsh.status', s)
}

/**
 * 获取一个空闲端口（宿主 net.getFreePort：沙箱下 worker 禁 node:net）。
 * dsh web 用该端口启动（--port），避免默认 3080 与残留/其它进程冲突。
 */
function getFreePort(): Promise<number> {
    return rpc.net.getFreePort() as Promise<number>
  }

// ---- Node.js 运行时解析（内置 host-api：rpc.nodejs.* 替代闭源版跨插件 invoke）----

/** 宿主代 execFile（一次性探测；child.execFile 白名单 + 超时由宿主裁决；非零退出码抛错，等价旧 execFileAsync） */
async function execFileHosted(node: string, args: string[], timeoutMs = 8000): Promise<string> {
  const r = await rpc.child.execFile({ cmd: node, args, timeout: timeoutMs })
  if (r.code !== 0) throw new Error(await dmsg('execFailed', { code: r.code, err: (r.stderr || r.stdout).slice(-300) }))
  return r.stdout
}

/**
 * 解析可用的 node 可执行文件绝对路径：内置（~/.dlient-open/plugin-data/nodejs LTS，优先）→
 * 本地（PATH/常见路径，兜底）→ 安装内置。与宿主 nodejs.resolveRuntime 的「内置优先」语义一致，
 * 避免本机旧版 node 跑 dsh 报 ESM/native 兼容错误。
 */
/** 记录实际选中的 node（路径 + 版本），便于定位 dsh 运行时的 node 环境 */
async function pickNode(node: string, source: string): Promise<string> {
  let version = '?'
  try {
    version = (await execFileHosted(node, ['--version'])).trim() || '?'
  } catch {
    /* 忽略 */
  }
  rpc.log.write('info', `[dsh] resolveNode -> ${source}: ${node} (${version})`)
  return node
}

async function resolveNode(): Promise<string> {
  // 1) 内置（bundled）优先：经 rpc.nodejs.resolveRuntime 统一解析（内置优先语义一致，避免裸 fs 探测）
  const rt = (await rpc.nodejs.resolveRuntime().catch(() => null)) as {
    source?: 'bundled' | 'path' | 'none'
    node?: string
  } | null
  if (rt?.source === 'bundled' && rt.node) return pickNode(rt.node, 'bundled')
  // 2) 本地兜底（内置未安装时）：PATH/常见安装路径里的 node
  if (rt?.source === 'path' && rt.node && rt.node !== 'node' && rt.node !== 'node.exe') {
    return pickNode(rt.node, 'local')
  }
  if (rt?.source === 'path' && rt.node) {
    // PATH 里的 node：探测真实 execPath（后续统一用 node 跑 npm/npx 的 cli.js，规避 .cmd 兼容问题）
    try {
      const stdout = await execFileHosted('node', ['-e', 'process.stdout.write(process.execPath)'])
      if (stdout) return pickNode(stdout.trim(), 'local(execPath)')
    } catch {
      /* 探测失败，继续安装内置 */
    }
  }
  // 3) 安装内置 LTS（本地也没有时）
  const res = (await rpc.nodejs.install().catch(() => null)) as {
    ok?: boolean
    path?: string
    error?: string
  } | null
  if (res?.ok && typeof res.path === 'string') return pickNode(res.path, 'installed')
  throw new Error(res?.error ?? (await dmsg('nodeMissing')))
}

/** node 同目录下的 npm/npx cli.js（标准安装布局：<nodeDir>/node_modules/npm/bin/<cli>） */
function nodeCliPath(node: string, cli: 'npm-cli.js' | 'npx-cli.js'): string {
  return join(dirname(node), 'node_modules', 'npm', 'bin', cli)
}

/** 子进程 env：把 node 目录前置到 PATH（dsh 的子进程/工具需要找到 node） */
function envWithNode(node: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const nodeDir = dirname(node)
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')
  const sep = process.platform === 'win32' ? ';' : ':'
  env[pathKey ?? 'PATH'] = `${nodeDir}${sep}${env[pathKey ?? 'PATH'] ?? ''}`
  return env
}

// ---- DSH 安装 / 启动 ----

/**
 * 该 node 对应的 npm 全局根（`npm --prefix <nodeDir> root -g`）。
 * 显式 --prefix 指向 node 目录：用户级 .npmrc 的 prefix（nvm 等会设置）会覆盖默认全局目录，
 * 导致 root -g 落到本机其它 node（如 nvm4w），dsh 装错位置、运行环境错乱。
 */
async function npmGlobalRoot(node: string): Promise<string> {
  const npmCli = nodeCliPath(node, 'npm-cli.js')
  const stdout = await execFileHosted(node, [npmCli, '--prefix', dirname(node), 'root', '-g'], 15000)
  const globalRoot = stdout.trim().split(/\r?\n/)[0]
  if (!globalRoot) throw new Error(await dmsg('npmGlobalMissing'))
  return globalRoot
}

/** 检查 @deepseek-ai/dsh 是否已安装到该 node 对应的 npm 全局目录（--prefix 定向，不受用户 .npmrc 影响） */
async function isDshInstalled(node: string): Promise<boolean> {
  try {
    const globalRoot = await npmGlobalRoot(node)
    return existsSync(join(globalRoot, '@deepseek-ai', 'dsh', 'package.json'))
  } catch {
    return false
  }
}

/** npm 全局安装 @deepseek-ai/dsh 到该 node 目录（--prefix 定向；幂等：已安装时 npm 会快速校验跳过） */
async function installDsh(node: string): Promise<void> {
  const npmCli = nodeCliPath(node, 'npm-cli.js')
  // 宿主代 spawn（child.spawn）：沙箱兼容；事件驱动等待退出（订阅回放保证不丢 exit）；超时 kill 并拒绝
  const handle = await rpc.child.spawn({ cmd: node, args: [npmCli, '--prefix', dirname(node), 'install', '-g', '@deepseek-ai/dsh'], env: envWithNode(node) })
  let out = ''
  handle.onStdout((d) => { out += d })
  handle.onStderr((d) => { out += d })
  const exited = new Promise<{ code: number | null }>((resolve) => handle.onExit((info) => resolve({ code: info.code })))
  const timer = setTimeout(() => {
    void handle.kill().catch(() => undefined)
  }, 180000)
  try {
    const { code } = await exited
    if (code === 0) return
    throw new Error(await dmsg('npmInstallFailed', { code: code ?? 0, out: out.slice(-500) }))
  } finally {
    clearTimeout(timer)
  }
}

/** 探测 127.0.0.1:port 是否已可访问（宿主 net.probePort：沙箱下 worker 禁 fetch） */
async function probePort(port: number): Promise<boolean> {
    return (await rpc.net.probePort(port)) as boolean
  }

/**
 * @deepseek-ai/dsh 的 cli 入口绝对路径（读包 manifest 的 bin）。
 * 不用 npx：npx 在 Windows 经 bin shim（.cmd 内 `node cli.js`）执行，node 由 PATH 解析，
 * 可能落到本机旧版（v18）；这里直接用已解析的 node（内置 v24）跑 cli.js，保证整条链路同版本。
 */
async function dshCliPath(node: string): Promise<string> {
  const globalRoot = await npmGlobalRoot(node)
  const pkgDir = join(globalRoot, '@deepseek-ai', 'dsh')
  const raw = await readFile(join(pkgDir, 'package.json'), 'utf-8')
  const pkg = JSON.parse(raw) as { bin?: string | Record<string, string> }
  const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.dsh ?? '')
  if (!bin) throw new Error(await dmsg('binMissing'))
  const cli = join(pkgDir, bin)
  rpc.log.write('info', `[dsh] dshCliPath: ${cli}`)
  return cli
}

/**
 * 启动 `dsh web --no-open --host 127.0.0.1 --port <port>`（直接以 node 执行 dsh 的 cli.js，不经 npx），
 * 等待指定端口就绪后返回 URL。端口由调用方（getFreePort）预先分配，避免默认 3080 冲突。
 * 宿主代 spawn（child.spawn）：dsh web 即该子进程本身，生命周期（含 worker 退出/崩溃回收）由宿主管理。
 */
async function startDsh(node: string, port: number): Promise<{ url: string }> {
  const cliJs = await dshCliPath(node)
  const handle = await rpc.child.spawn({
    cmd: node,
    args: [cliJs, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
    env: envWithNode(node),
  })
  child = handle
  let output = ''
  handle.onStdout((d) => { output += d })
  handle.onStderr((d) => { output += d })
  return await new Promise<{ url: string }>((resolve, reject) => {
    let settled = false
    const timer = setInterval(async () => {
      if (await probePort(port)) {
        settled = true
        clearInterval(timer)
        resolve({ url: `http://127.0.0.1:${port}` })
        return
      }
      if (Date.now() >= deadline) {
        settled = true
        clearInterval(timer)
        if (child === handle) child = null
        reject(new Error(`DSH web 服务启动超时。输出：${output.slice(-300)}`))
      }
    }, 500)
    const deadline = Date.now() + 120000
    // 进程提前退出 → 启动失败（附 node 版本便于定位运行时环境）
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (child === handle) child = null
      reject(err)
    }
    handle.onExit(({ code }) => {
      fail(new Error(`dsh 进程已退出（exit ${code ?? 'unknown'}, node ${process.execPath}）: ${output.slice(-300)}`))
    })
    handle.onError((err) => fail(err instanceof Error ? err : new Error(String(err))))
  })
}

// ---- 对外方法（渲染端 api.request / 其它插件 plugin.invoke）----

rpc.registerHandler('dsh.start', async () => {
  if (child) return { ok: true, url: current.url }
  try {
    // 分配空闲端口供 dsh web 监听（--port）。旧端口残留无需清理：每次新分配空闲端口，
    // 且 dsh web 由宿主代管，worker/宿主退出时宿主整树回收，不会遗留占端口进程。
    const port = await getFreePort()
    pushStatus({ phase: 'checking-node' })
    const node = await resolveNode()
    // 已安装则跳过安装，直接启动（避免重复下载）
    if (!(await isDshInstalled(node))) {
      pushStatus({ phase: 'installing-dsh' })
      await installDsh(node)
    }
    pushStatus({ phase: 'starting' })
    const { url } = await startDsh(node, port)
    pushStatus({ phase: 'ready', url, startedOnce: true })
    return { ok: true, url }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    pushStatus({ phase: 'error', error: message, startedOnce: current.startedOnce === true })
    return { ok: false, error: message }
  }
})

rpc.registerHandler('dsh.stop', async () => {
  const handle = child
  child = null
  // 宿主代管句柄：kill = 整树回收（taskkill /T 或进程组 SIGKILL），无残留兜底需求
  await handle?.kill()
  pushStatus({ phase: 'idle', startedOnce: true })
  return { ok: true }
})

rpc.registerHandler('dsh.status', () => current)

// dsh web 由宿主代管（child.spawn + owner 登记）：worker 退出/崩溃 → 宿主 killChildrenByOwner 整树回收，
// 无需 worker 侧 exit/signal 清理（旧 PID 文件 + netstat/taskkill 机制已删）。
