/**
 * api/child.ts - child 模块 host-api（元数据 + handler；实现经 lib/child.ts 收敛）。
 * v2 §6.4 精简完成：kill/readOutput/writeStdin/stdinEnd 已删除（句柄内聚：操作走 worker→宿主控制消息通道）；
 * register/unregister/killTree/list 属 SDK/宿主内部使用，不在 api 目录导出。
 * child.spawn 跨进程返回 { handleId, pid }（完整操作在宿主进程内句柄 / SDK ChildHandle 上）。
 */
import type { ApiDefinition } from './types'
import { execFileChild, hostSpawnChild, toSpawnRef, type SpawnOptions } from '../lib/child'

export const childApis: ApiDefinition[] = [
  {
    key: 'child.spawn',
    description: { 'zh-CN': '启动子进程（返回句柄标识）', 'en-US': 'Spawn subprocess (returns handle)' },
    scope: 'all',
    level: 'dangerous',
    handler: async ([options], ctx) => toSpawnRef(await hostSpawnChild(ctx.pluginId, (options ?? {}) as SpawnOptions)),
  },
  {
    key: 'child.execFile',
    description: { 'zh-CN': '一次性执行命令捕获输出', 'en-US': 'Run command once, capture output' },
    scope: 'all',
    level: 'dangerous',
    handler: ([options], ctx) => execFileChild(ctx.pluginId, (options ?? {}) as SpawnOptions & { timeout?: number }),
  },
]
