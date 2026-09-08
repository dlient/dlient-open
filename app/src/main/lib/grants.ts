/**
 * lib/grants.ts - 资源级授权链（方案 v2：复杂授权逻辑下沉 lib；api/* 与宿主授权流引用）。
 * hooks（resourceGrants / confirmResource / isSystemPlugin）由宿主装配经 registerGrantHooks 注入。
 */
import { DlientError, DlientErrorCode, logger } from '@dlient-open/core'
import { mt } from '../i18n'
import { evaluateNetPolicy } from './net'
import type { ResourceGrantStore } from '../resource-grants'
import type { RuntimeConfirmRequest, RuntimeConfirmResult } from '../runtime'

/** 资源级授权接入（dialog / net / spawn 授权流使用；主进程装配时注入） */
export interface ResourceAccessHooks {
  resourceGrants: Record<'fs' | 'net' | 'spawn', ResourceGrantStore>
  /** 资源级运行时确认（渲染层统一弹框：type / description / 作用域三选） */
  confirmResource: (req: RuntimeConfirmRequest) => Promise<RuntimeConfirmResult>
  /** 是否为 system 插件（system 免用户确认，直接持久授权） */
  isSystemPlugin: (pluginId: string) => boolean
  /** 向某插件 worker 推送宿主主动消息（child-event 流式输出/退出） */
  sendToWorker?: (instanceKey: string, message: unknown) => void
}

let hooks: ResourceAccessHooks | null = null

/** 宿主装配注入授权 hooks（lib/child.ts registerResourceAccessHooks 转发） */
export function registerGrantHooks(h: ResourceAccessHooks | null): void {
  hooks = h
}

/** 读取已注入的授权 hooks（lib/permission.ts、export.ts executeHostApi 等复用同一注入源；未装配返回 null） */
export function getGrantHooks(): ResourceAccessHooks | null {
  return hooks
}

/**
 * fs 访问授权（§4.3）：system 插件免确认直接持久授权；
 * 否则发 fs-access 统一弹框（含 description），按所选作用域写 fs-grants。
 */
export async function authorizeFsAccess(
  pluginId: string,
  filePaths: string[],
  perms: string[],
  description?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const h = hooks
  if (!h) return { ok: true } // 无授权环境（独立装配）：防御放行
  // 按 permissions 同时授权 read/write 两档（fs 白名单按 target+mode 分档校验，缺档后续 fs.* 仍会被拒）
  const wantRead = perms.includes('fs.read')
  const wantWrite = perms.includes('fs.write')
  if (!wantRead && !wantWrite) return { ok: true }
  if (h.isSystemPlugin(pluginId)) {
    for (const p of filePaths) {
      if (wantRead) h.resourceGrants.fs.grant(pluginId, p, { mode: 'read' })
      if (wantWrite) h.resourceGrants.fs.grant(pluginId, p, { mode: 'write' })
    }
    return { ok: true }
  }
  const r = await h.confirmResource({
    type: 'fs-access',
    items: [
      {
        fromName: pluginId,
        targetName: pluginId,
        method: wantRead && wantWrite ? mt('resource.fs.readwrite') : wantRead ? mt('resource.fs.read') : mt('resource.fs.write'),
        resource: filePaths.join('；'),
        desc: description,
      },
    ],
    canScope: true,
  })
  if (!r.allow) return { ok: false, reason: 'user denied' }
  for (const p of filePaths) {
    if (wantRead) h.resourceGrants.fs.grant(pluginId, p, { mode: 'read', scope: r.scope })
    if (wantWrite) h.resourceGrants.fs.grant(pluginId, p, { mode: 'write', scope: r.scope })
  }
  return { ok: true }
}

/**
 * net 访问授权（§4.5）：URL 已命中 net-grants 放行；system 插件免确认直接持久授权；
 * 否则发 net-access 统一弹框（含 description），按所选作用域写 net-grants（域名/URL 前缀级）。
 */
export async function authorizeNetAccess(
  pluginId: string,
  url: string,
  description?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const h = hooks
  if (!h) return { ok: true } // 无授权环境（独立装配）：防御放行
  if (!url) return { ok: false, reason: 'empty url' }
  // SSRF 收口（docs/guides/ui-host-api.md §2.4）：云 metadata / 广播无条件硬禁；
  // 内网/回环默认拒绝——已授权（net-grants）或 system 插件放行，其余走 net-access 确认。
  const pol = await evaluateNetPolicy(url)
  if (pol.hardDenied) {
    logger.warn('security', 'net ssrf hard blocked', { pluginId, host: pol.host, url })
    throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `network access to ${pol.host} is not allowed (reserved/cloud metadata)`)
  }
  if (pol.internal) {
    if (h.resourceGrants.net.isUrlAllowed(pluginId, url)) return { ok: true }
    if (h.isSystemPlugin(pluginId)) {
      h.resourceGrants.net.grant(pluginId, url)
      return { ok: true }
    }
    const r = await h.confirmResource({
      type: 'net-access',
      items: [
        {
          fromName: pluginId,
          targetName: pluginId,
          method: mt('resource.category.net'),
          resource: `${url}（内网/本机地址）`,
          desc: description,
        },
      ],
      canScope: true,
    })
    if (!r.allow) return { ok: false, reason: 'user denied' }
    h.resourceGrants.net.grant(pluginId, url, { scope: r.scope })
    return { ok: true }
  }
  if (h.resourceGrants.net.isUrlAllowed(pluginId, url)) return { ok: true }
  if (h.isSystemPlugin(pluginId)) {
    h.resourceGrants.net.grant(pluginId, url)
    return { ok: true }
  }
  const r = await h.confirmResource({
    type: 'net-access',
    items: [
      {
        fromName: pluginId,
        targetName: pluginId,
        method: mt('resource.category.net'),
        resource: url,
        desc: description,
      },
    ],
    canScope: true,
  })
  if (!r.allow) return { ok: false, reason: 'user denied' }
  h.resourceGrants.net.grant(pluginId, url, { scope: r.scope })
  return { ok: true }
}

/** 完整命令行展示串（spawn-confirm 弹框 resource；截断防弹框撑爆） */
export function buildSpawnCommandLine(cmd: string, args: string[]): string {
  const a = Array.isArray(args) ? args.map(String) : []
  const line = a.length ? `${cmd} ${a.join(' ')}` : cmd
  return line.length > 512 ? `${line.slice(0, 512)}…` : line
}

/**
 * spawn 命令授权（§5.4 / 修复任务 F9）：命中白名单放行；args-denied（cmd 命中规则但参数违约）→ PERMISSION_DENIED 硬拒绝 + 审计；
 * 未命中（nomatch）→ system 免确认直接授权 cmd，否则发 spawn-confirm 弹框（展示完整命令行 `cmd + args`），按所选作用域写 spawn-grants。
 */
export async function authorizeSpawn(
  pluginId: string,
  cmd: string,
  args: string[] = [],
  description?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const h = hooks
  if (!h) return { ok: true } // 无授权环境（独立装配）：防御放行
  if (!cmd) return { ok: false, reason: 'empty cmd' }
  const verdict = h.resourceGrants.spawn.isSpawnAllowed(pluginId, cmd, args)
  if (verdict === 'allow') return { ok: true }
  if (verdict === 'args-denied') {
    // F9：cmd 命中 manifest 规则但参数违约 → 硬拒绝（不弹框），记审计
    logger.warn('security', 'spawn args denied', {
      pluginId,
      cmd,
      args: Array.isArray(args) ? args.map(String).slice(0, 64) : [],
      reason: 'argsPattern violated',
    })
    throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `spawn args not allowed: ${cmd}`)
  }
  if (h.isSystemPlugin(pluginId)) {
    h.resourceGrants.spawn.grant(pluginId, cmd)
    return { ok: true }
  }
  const r = await h.confirmResource({
    type: 'spawn-confirm',
    items: [
      {
        fromName: pluginId,
        targetName: pluginId,
        method: mt('resource.spawn'),
        resource: buildSpawnCommandLine(cmd, args),
        desc: description,
      },
    ],
    canScope: true,
  })
  if (!r.allow) return { ok: false, reason: 'user denied' }
  h.resourceGrants.spawn.grant(pluginId, cmd, { scope: r.scope })
  return { ok: true }
}

/**
 * fs 路径白名单强制校验（§4.1）：system 插件全放行；否则命中 DATA / fsDirs / grants（持久/会话/临时）才放行，
 * 未命中 → PERMISSION_DENIED。所有 fs.* 方法在 executeHostApi 统一调用。
 */
export function assertPathAllowed(pluginId: string, absPath: string, mode: 'read' | 'write'): void {
  const h = hooks
  if (!h) return // 无授权环境（独立装配）：防御放行
  if (process.env.DLIENT_DISABLE_FS_ENFORCE === '1') return // 紧急逃生（插件 fsDirs 迁移未完时可关）
  if (h.isSystemPlugin(pluginId)) return // system 插件可触碰宿主内部目录（§4.2）
  if (!h.resourceGrants.fs.isPathAllowed(pluginId, absPath, mode)) {
    throw new DlientError(DlientErrorCode.PERMISSION_DENIED, `fs path not allowed (${mode}): ${absPath}`)
  }
}

/** fs.* 方法 → 路径参数下标与读写档（executeHostApi 统一强制白名单校验） */
export const FS_PATH_MODE: Record<string, { args: number[]; mode: 'read' | 'write' }> = {
  'fs.read': { args: [0], mode: 'read' },
  'fs.stat': { args: [0], mode: 'read' },
  'fs.listDir': { args: [0], mode: 'read' },
  'fs.watch': { args: [0], mode: 'read' },
  'fs.mkdir': { args: [0], mode: 'write' },
  'fs.write': { args: [0], mode: 'write' },
  'fs.append': { args: [0], mode: 'write' },
  'fs.delete': { args: [0], mode: 'write' },
  'fs.copyDir': { args: [0, 1], mode: 'write' },
  'fs.lock': { args: [0], mode: 'write' },
  'fs.unlock': { args: [0], mode: 'write' },
  'fs.withLock': { args: [0], mode: 'write' },
}

export type { RuntimeConfirmRequest, RuntimeConfirmResult }
