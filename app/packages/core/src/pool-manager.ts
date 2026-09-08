/**
 * pool-manager.ts - 共享 worker 池（进程池化）。
 *
 * 解决「插件多 → fork 子进程多」的内存/句柄问题：同池内多个插件的 worker.js 运行在
 * 同一个 utilityProcess（pool-worker.js）中，每插件仍持独立 MessagePortMain
 * （控制面 ctl + 渲染层直连 direct），消息格式与独立进程模式完全一致。
 *
 * 分池规则：
 *  - system 插件独立池（可信、随基座生命周期、崩溃影响面可控）；
 *  - 其它插件按类型（app / full / worker）分池；
 *  - 每池插件数上限 POOL_CAPACITY（8），超限自动新建同类型池实例。
 *
 * 进程级封禁：除 system 池外全部池（shared + solo）注入 Node Permission Model
 * （--permission + 目录前缀读集；禁 fs 写 / child-process / worker / addon）。
 *
 * 池崩溃：池内全部插件按「worker 退出」通知（控制器清理运行态；下次调用自动重建池）。
 * 池内热重载/重启：unload（清 require 缓存）+ 重新 load，不重启进程。
 */

import { utilityProcess, type UtilityProcess, type MessagePortMain } from 'electron'

export const POOL_CAPACITY = 8
/** 单 worker 池容量（solo：一插件一池一进程，永不共享） */
export const SOLO_POOL_CAPACITY = 1
/** solo 池 key 前缀（key = `solo:<instanceKey>`，唯一不共享） */
export const SOLO_POOL_PREFIX = 'solo:'

export interface PoolLoadArgs {
  pluginId: string
  workerEntry: string
  generation: number
  /** 控制面 port2（MessageChannelMain），transfer 进池交给该插件 rpc 作为控制通道 */
  ctl2: MessagePortMain
  /** 直连 port2（MessageChannelMain），transfer 进池交给该插件 rpc 作为 directPort */
  direct2: MessagePortMain
}

/** 插件控制器依赖的池接口（PluginController options.pool） */
export interface PluginPool {
  readonly key: string
  readonly alive: boolean
  readonly pluginCount: number
  loadPlugin(args: PoolLoadArgs): void
  unloadPlugin(pluginId: string): void
  /** 重建某插件直连通道（refreshDirectPort）：transfer 新 direct2 进池 */
  reattachDirect(pluginId: string, direct2: MessagePortMain): void
  /** 池退出通知（崩溃/被杀）：注册返回取消函数 */
  onPoolExit(cb: (reason: string) => void): () => void
  /** 插件加载失败通知（worker.js require 抛错） */
  onLoadFailed(cb: (pluginId: string, error: string) => void): () => void
}

interface PoolMessage {
  type: string
  pluginId?: string
  error?: string
}

export interface PoolManagerOptions {
  /** pool-worker.js 绝对路径（主进程产物目录） */
  poolWorkerPath: string
  /**
   * 进程级封禁（Node Permission Model，docs/specs/plugin-permission.md §2）：
   *  - enabled：除 system 池外所有池注入 `--permission` + `--allow-fs-read=<readDirs>`；
   *    readDirs 为**目录前缀并集**（共享运行时目录 + 插件根目录 + app node_modules），
   *    fs 写与 child-process / worker / addon 全禁；
   *  - readDirs：worker 启动所需最小读集（共享运行时目录 + 插件根目录 + app node_modules）。
   */
  permission?: { enabled?: boolean; readDirs?: string[] }
}

export class PoolManager {
  private pools = new Map<string, PoolInstance[]>()
  private poolWorkerPath: string
  private permission?: { enabled?: boolean; readDirs?: string[] }

  constructor(options: PoolManagerOptions) {
    this.poolWorkerPath = options.poolWorkerPath
    this.permission = options.permission
  }

  /** solo 池键（含插件 id）：每个 solo 插件独占一个池实例（容量 1），永不与其他插件共享。
   *  dev 插件键带 'dev:' 前缀，与正式实例（同 id）隔离为不同池。 */
  soloKeyFor(manifest: { id?: string; type?: string; source?: string }): string {
    return `${SOLO_POOL_PREFIX}${manifest.source === 'dev' ? 'dev:' : ''}${manifest.id ?? manifest.type ?? 'full'}`
  }

  /** 池键：system 独立；workerMode==='solo' → 单 worker 池（solo:<id>）；其它按插件类型。
   *  dev 插件（source==='dev'）无论 workerMode 如何都强制 solo（开发期隔离，崩溃/阻塞不连累共享池）。
   *  market/local 插件的阶段 2 计数评估（观察期/隔离 → solo）由装配层在 provider 处叠加判断。 */
  poolKeyFor(manifest: { id?: string; system?: boolean; type?: string; source?: string; workerMode?: 'shared' | 'solo' }): string {
    if (manifest.system) return 'system'
    if (manifest.source === 'dev' || manifest.workerMode === 'solo') {
      return this.soloKeyFor(manifest)
    }
    return manifest.type === 'app' ? 'app' : manifest.type === 'worker' ? 'worker' : 'full'
  }

  /** 取（或新建）指定键的可用池：同键池列表找未满的，无则新建。
   *  solo 键（solo:*）容量恒为 1：同一插件重入时复用已有池；其它插件键不同不会误入。 */
  poolFor(key: string): PluginPool {
    const list = this.pools.get(key) ?? []
    const capacity = key.startsWith(SOLO_POOL_PREFIX) ? SOLO_POOL_CAPACITY : POOL_CAPACITY
    let pool = list.find((p) => p.alive && p.plugins.size < capacity)
    if (!pool) {
      pool = new PoolInstance(key, list.length + 1, this.poolWorkerPath, capacity, this.permission)
      list.push(pool)
      this.pools.set(key, list)
    }
    return pool
  }

  /** 池内插件加载失败（worker.js require 抛错）统一记录（控制器侧另经 onLoadFailed 感知） */
  // 记录在 PoolInstance 内部（stdout/stderr 转发 + load-failed 消息），无需此处额外处理。

  dispose(): void {
    for (const list of this.pools.values()) {
      for (const pool of list) pool.dispose()
    }
    this.pools.clear()
  }
}

class PoolInstance implements PluginPool {
  readonly key: string
  readonly seq: number
  readonly plugins = new Map<string, { workerEntry: string }>()
  /** 池容量：共享池 = POOL_CAPACITY（8）；solo 池 = 1（一插件一池，永不共享） */
  private readonly capacity: number
  private child?: UtilityProcess
  private exited = false
  private exitCallbacks = new Set<(reason: string) => void>()
  private loadFailedCallbacks = new Set<(pluginId: string, error: string) => void>()
  private readonly permission?: { enabled?: boolean; readDirs?: string[] }

  constructor(
    key: string,
    seq: number,
    workerPath: string,
    capacity = POOL_CAPACITY,
    permission?: { enabled?: boolean; readDirs?: string[] },
  ) {
    this.key = key
    this.seq = seq
    this.capacity = capacity
    this.permission = permission
    this.fork(workerPath)
  }

  get alive(): boolean {
    return !this.exited && !!this.child
  }

  get pluginCount(): number {
    return this.plugins.size
  }

  private fork(workerPath: string): void {
    // 进程级封禁（docs/specs/plugin-permission.md §2）：除 system 池（全放权、可信）外全部注入。
    //  - readDirs：装配层给定（pluginsRoot / app node_modules / 主进程产物目录等）**目录前缀并集**，
    //    覆盖池内各插件运行目录（shared 池不逐插件追加，fork 后 execArgv 不可变，前缀覆盖已足够）；
    //  - fs 写 / child-process / worker_threads / .node addon 一律不 allow（全禁）；
    //  - --allow-net：临时策略（2026-09-02）——市面大量 npm 包内部直连 net（mysql/ssh2/pg 等），
    //    先允许 worker 直开 socket；net-grants / net-access 逐目标授权机制保留（宿主 net.* 仍走该校验），
    //    恢复严格模式（worker 禁 net、一律走宿主授权）时删除本行即可。
    const isSystem = this.key === 'system'
    const execArgv =
      this.permission?.enabled && !isSystem
        ? [
            '--permission',
            `--allow-fs-read=${(this.permission.readDirs ?? []).join(',')}`,
            '--allow-net',
          ]
        : []
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: `dlient-pool-${this.key}-${this.seq}`,
      stdio: 'pipe',
      execArgv,
    })
    this.child = child
    // 池 worker 日志转发（带池标签）
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd()
      if (text) console.log(`[pool:${this.key}#${this.seq}] ${text}`)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd()
      if (text) console.error(`[pool:${this.key}#${this.seq}] ${text}`)
    })
    // 池级消息：load-ok / load-failed / unload-ok / pool-heartbeat
    child.on('message', (msg: PoolMessage) => {
      if (msg.type === 'load-failed' && msg.pluginId) {
        console.error(`[pool:${this.key}#${this.seq}] load-failed ${msg.pluginId}: ${msg.error ?? 'unknown error'}`)
        for (const cb of this.loadFailedCallbacks) {
          try {
            cb(msg.pluginId, msg.error ?? 'load failed')
          } catch {
            /* 回调异常忽略 */
          }
        }
      }
    })
    child.on('exit', (code) => {
      this.exited = true
      this.child = undefined
      console.error(`[pool:${this.key}#${this.seq}] exited: ${code}`)
      for (const cb of this.exitCallbacks) {
        try {
          cb(`pool exited: ${code}`)
        } catch {
          /* 回调异常忽略 */
        }
      }
    })
  }

  loadPlugin(args: PoolLoadArgs): void {
    if (!this.alive) throw new Error(`pool ${this.key}#${this.seq} not alive`)
    this.plugins.set(args.pluginId, { workerEntry: args.workerEntry })
    this.child!.postMessage(
      { type: 'load-plugin', pluginId: args.pluginId, workerEntry: args.workerEntry, generation: args.generation },
      [args.ctl2, args.direct2],
    )
  }

  unloadPlugin(pluginId: string): void {
    const entry = this.plugins.get(pluginId)
    if (!entry) return
    this.plugins.delete(pluginId)
    if (this.alive) {
      this.child!.postMessage({ type: 'unload-plugin', pluginId, workerEntry: entry.workerEntry })
    }
    // solo 池空池回收：卸载后无其它插件 → kill 进程释放资源（否则 dev 反复启停会堆积池进程）
    if (this.capacity === SOLO_POOL_CAPACITY && this.plugins.size === 0) {
      this.child?.kill()
      this.child = undefined
      this.exited = true
    }
  }

  reattachDirect(pluginId: string, direct2: MessagePortMain): void {
    if (!this.alive) return
    this.child!.postMessage({ type: 'reattach-direct', pluginId }, [direct2])
  }

  onPoolExit(cb: (reason: string) => void): () => void {
    this.exitCallbacks.add(cb)
    return () => {
      this.exitCallbacks.delete(cb)
    }
  }

  onLoadFailed(cb: (pluginId: string, error: string) => void): () => void {
    this.loadFailedCallbacks.add(cb)
    return () => {
      this.loadFailedCallbacks.delete(cb)
    }
  }

  dispose(): void {
    this.child?.kill()
    this.child = undefined
    this.exited = true
    this.exitCallbacks.clear()
    this.loadFailedCallbacks.clear()
    this.plugins.clear()
  }
}
