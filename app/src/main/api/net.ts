/**
 * api/net.ts - net 模块 host-api（已完整迁移：元数据 + handler）。
 * fetch/request 经 net-grants 授权；端口分配/探测复用宿主辅助。
 */
import { net } from 'electron'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import type { ApiDefinition } from './types'
import { authorizeNetAccess } from '../lib/grants'
import { getFreePort, probePort } from '../lib/net'

export const netApis: ApiDefinition[] = [
  {
    key: 'net.isOnline',
    description: { 'zh-CN': '联网状态只读', 'en-US': 'Online status (read-only)' },
    scope: 'all',
    level: 'default',
    handler: () => net.isOnline(),
  },
  {
    key: 'net.fetch',
    description: { 'zh-CN': 'HTTP 请求（net-grants 授权）', 'en-US': 'HTTP fetch (net-grants)' },
    scope: 'all',
    level: 'warn',
    handler: async ([url, init, description], ctx) => {
      const u = String(url ?? '')
      const desc = typeof description === 'string' && description.trim() ? description.trim() : undefined
      const auth = await authorizeNetAccess(ctx.pluginId, u, desc)
      if (!auth.ok) throw new DlientError(DlientErrorCode.USER_DENIED, 'user denied network access')
      const o = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: unknown }
      const res = await net.fetch(u, {
        method: o.method,
        headers: o.headers,
        body: typeof o.body === 'string' ? o.body : undefined,
      })
      const body = Buffer.from(await res.arrayBuffer()).toString('base64')
      return { ok: res.ok, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body }
    },
  },
  {
    key: 'net.request',
    description: { 'zh-CN': 'HTTP 请求（net-grants 授权）', 'en-US': 'HTTP request (net-grants)' },
    scope: 'all',
    level: 'warn',
    handler: async ([options, description], ctx) => {
      const o = (options ?? {}) as { url?: string; method?: string; headers?: Record<string, string>; body?: unknown }
      const u = String(o.url ?? '')
      const desc = typeof description === 'string' && description.trim() ? description.trim() : undefined
      const auth = await authorizeNetAccess(ctx.pluginId, u, desc)
      if (!auth.ok) throw new DlientError(DlientErrorCode.USER_DENIED, 'user denied network access')
      const res = await net.fetch(u, {
        method: o.method,
        headers: o.headers,
        body: typeof o.body === 'string' ? o.body : undefined,
      })
      const body = Buffer.from(await res.arrayBuffer()).toString('base64')
      return { ok: res.ok, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body }
    },
  },
  {
    key: 'net.getFreePort',
    description: { 'zh-CN': '分配空闲端口', 'en-US': 'Allocate free port' },
    scope: 'all',
    level: 'default',
    handler: () => getFreePort(),
  },
  {
    key: 'net.probePort',
    description: { 'zh-CN': '端口连通探测', 'en-US': 'Probe port reachability' },
    scope: 'all',
    level: 'default',
    handler: ([port]) => probePort(Number(port)),
  },
]
