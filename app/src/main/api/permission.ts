/**
 * api/permission.ts - permission 模块 host-api（元数据 + handler；实现经 lib/permission.ts）。
 * 命名已切换：auth.* → permission.*（v2 §6.3）；撤销合并为 permission.revoke(type, options)；
 * 新增 permission.list（查看自己插件的授权）。
 */
import type { ApiDefinition } from './types'
import { listPluginGrants, requestGrants, revokeResourceGrant } from '../lib/permission'

export const permissionApis: ApiDefinition[] = [
  {
    key: 'permission.plugin.list',
    description: { 'zh-CN': '查看插件资源授权（管理视角）', 'en-US': 'List plugin resource grants (admin)' },
    scope: 'system',
    level: 'dangerous',
    handler: ([pluginId]) => listPluginGrants(String(pluginId ?? '')),
  },
  {
    key: 'permission.revoke',
    description: { 'zh-CN': '撤销插件资源授权（type ∈ fs|net|spawn）', 'en-US': 'Revoke plugin resource grant (type ∈ fs|net|spawn)' },
    scope: 'system',
    level: 'dangerous',
    handler: ([type, options]) => revokeResourceGrant(String(type ?? 'fs'), (options ?? {}) as { pluginId?: string; target?: string }),
  },
  {
    key: 'permission.request',
    description: { 'zh-CN': '批量申请资源授权', 'en-US': 'Request resource grants' },
    scope: 'worker',
    level: 'warn',
    handler: ([resources, description], ctx) => requestGrants(ctx.pluginId, resources, description),
  },
  {
    key: 'permission.list',
    description: { 'zh-CN': '查看自己插件的资源授权', 'en-US': 'List own plugin resource grants' },
    scope: 'all',
    level: 'default',
    handler: (_args, ctx) => listPluginGrants(ctx.pluginId),
  },
]
