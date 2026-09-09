/**
 * api/nodejs.ts - nodejs 模块 host-api（开源版内置 Node.js 运行时）。
 *
 * 替代闭源版「nodejs 插件」的跨插件 invoke：nodejs 已并入宿主主进程
 * （src/main/nodejs.ts 单例模块），本表把它作为普通 host-api 暴露给插件 worker——
 * 声明 manifest.permissions 的 nodejs.* 即可直接 rpc.nodejs.resolveRuntime() 等，
 * 无需 nodejs 插件在池中运行。语义与旧插件 expose 保持一致（方法名/参数/返回不变），
 * 存量插件把 `plugin.invoke('nodejs', 'nodejs.x')` 换成 `rpc.nodejs.x()` 即可迁移。
 */
import type { ApiDefinition } from './types'
import { checkBundled, checkLocal, installNodejs, resolveRuntime } from '../nodejs'

export const nodejsApis: ApiDefinition[] = [
  {
    key: 'nodejs.checkLocal',
    description: {
      'zh-CN': '检测本地（PATH/常见路径）Node.js 运行时',
      'en-US': 'Probe local (PATH / well-known paths) Node.js runtime',
    },
    scope: 'all',
    level: 'default',
    handler: ([opts]) => checkLocal((opts ?? {}) as { version?: string }),
  },
  {
    key: 'nodejs.checkBundled',
    description: {
      'zh-CN': '检测内置 Node.js 运行时（~/.dlient-open/plugin-data/nodejs）',
      'en-US': 'Probe bundled Node.js runtime (~/.dlient-open/plugin-data/nodejs)',
    },
    scope: 'all',
    level: 'default',
    handler: ([opts]) => checkBundled((opts ?? {}) as { version?: string }),
  },
  {
    key: 'nodejs.resolveRuntime',
    description: {
      'zh-CN': '解析可用 Node.js 运行时（内置优先，PATH 兜底）',
      'en-US': 'Resolve a usable Node.js runtime (bundled preferred, then PATH)',
    },
    scope: 'all',
    level: 'default',
    handler: ([opts]) => resolveRuntime((opts ?? {}) as { version?: string }),
  },
  {
    key: 'nodejs.install',
    description: {
      'zh-CN': '安装内置 LTS Node.js 运行时（单飞；下载到插件隔离目录）',
      'en-US': 'Install bundled LTS Node.js runtime (single-flight; downloads to userData)',
    },
    scope: 'all',
    level: 'warn',
    handler: ([version]) => installNodejs(typeof version === 'string' ? version : undefined),
  },
]
