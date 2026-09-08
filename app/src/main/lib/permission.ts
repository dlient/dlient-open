/**
 * lib/permission.ts - permission 授权管理实现（方案 v2：原 auth.* / fs.revokeAccess / net.revokeUrl
 * 的查询 / 撤销 / 批量申请下沉 lib）。hooks（resourceGrants / confirmResource / isSystemPlugin）
 * 复用 lib/grants.ts 注入源。
 * 命名切换批次将 auth.* → permission.*。
 */
import { mt } from '../i18n'
import { getGrantHooks } from './grants'

/** fs 请求授权档位（auth.requestGrants 的 fs 项 mode 字段） */
type FsRequestMode = 'read' | 'write'

/** 解析 fs 请求的授权档位：mode 支持 'read' / 'write' / ['read','write']；
 * 缺省或非法值默认读写双档（兼容历史未带 mode 的调用，目录级授权语义为双档）。
 * 返回去重后的档位数组（保序、非空）。 */
function parseFsRequestModes(mode: unknown): FsRequestMode[] {
  const rawList = Array.isArray(mode) ? mode.map(String) : [String(mode ?? '')]
  const modes = new Set<FsRequestMode>()
  for (const m of rawList) {
    if (m === 'read' || m === 'write') modes.add(m)
  }
  if (modes.size === 0) {
    modes.add('read')
    modes.add('write')
  }
  return Array.from(modes)
}

/** fs 请求档位 → 弹框方法文案（按主进程当前语言） */
function fsRequestMethodText(modes: FsRequestMode[]): string {
  const hasRead = modes.includes('read')
  const hasWrite = modes.includes('write')
  if (hasRead && hasWrite) return mt('resource.fs.readwrite')
  return hasRead ? mt('resource.fs.read') : mt('resource.fs.write')
}

/** 列出某插件的资源授权（市场「权限」页展示用 / permission.list 查看自己授权） */
export function listPluginGrants(pluginId: string): { fs: unknown[]; net: unknown[]; spawn: unknown[] } {
  const hooks = getGrantHooks()
  const pid = String(pluginId ?? '')
  return {
    fs: hooks?.resourceGrants.fs.list(pid) ?? [],
    net: hooks?.resourceGrants.net.list(pid) ?? [],
    spawn: hooks?.resourceGrants.spawn.list(pid) ?? [],
  }
}

/** 通用撤销（permission.revoke）：type ∈ fs | net | spawn；options = { pluginId, target }（target 为 path/url/cmd）
 * （合并原 fs.revokeAccess / net.revokeUrl / auth.revokeGrant 三个撤销入口） */
export function revokeResourceGrant(type: string, options: { pluginId?: string; target?: string }): { ok: boolean } {
  const t = String(type ?? 'fs')
  const pid = String(options?.pluginId ?? '')
  const tg = String(options?.target ?? '')
  const hooks = getGrantHooks()
  if (t === 'net') hooks?.resourceGrants.net.revoke(pid, tg)
  else if (t === 'spawn') hooks?.resourceGrants.spawn.revoke(pid, tg)
  else hooks?.resourceGrants.fs.revoke(pid, tg)
  return { ok: true }
}

/** 批量预授权申请（auth.requestGrants）：一次性列出 fs/net/spawn 资源让用户授权，避免运行时逐个弹框（§4.6） */
export async function requestGrants(
  pluginId: string,
  resources: unknown,
  description: unknown,
): Promise<{ granted: string[]; denied: string[] }> {
  const hooks = getGrantHooks()
  const items = Array.isArray(resources) ? (resources as Array<Record<string, unknown>>) : []
  if (!hooks) {
    // 无授权环境（独立装配）：防御放行
    return { granted: items.map((r) => String((r as { resource?: unknown }).resource ?? '')), denied: [] }
  }
  const desc = typeof description === 'string' && description.trim() ? description.trim() : undefined
  // 请求项携带授权档位：fs 项按 mode 声明申请 read / write / 两者（缺省默认双档）；
  // net / spawn 无档位概念（命中即放行），modes 恒为空。
  const requested: Array<{ type: 'fs' | 'net' | 'spawn'; target: string; modes: FsRequestMode[] }> = []
  for (const raw of items) {
    const r = (raw ?? {}) as { type?: string; path?: string; url?: string; cmd?: string; mode?: unknown }
    const t = r.type
    if (t === 'net' && typeof r.url === 'string' && r.url) requested.push({ type: 'net', target: r.url, modes: [] })
    else if (t === 'spawn' && typeof r.cmd === 'string' && r.cmd) requested.push({ type: 'spawn', target: r.cmd, modes: [] })
    else if (typeof r.path === 'string' && r.path) requested.push({ type: 'fs', target: r.path, modes: parseFsRequestModes(r.mode) })
  }
  // 已授权判定按「请求项」粒度逐档进行：只申请 read 则只查 read 档，只申请 write 则只查 write 档，
  // 读写同请才两档一起查（fs 白名单按 target+mode 分档落库，缺档会命中白名单拒绝）；
  // net / spawn 命中即已授权。已授权项默认放行不入弹框，仅未授权项进 pending。
  const alreadyGranted = (g: { type: 'fs' | 'net' | 'spawn'; target: string; modes: FsRequestMode[] }): boolean =>
    g.type === 'fs'
      ? g.modes.every((m) => hooks.resourceGrants.fs.isPathAllowed(pluginId, g.target, m))
      : g.type === 'net'
        ? hooks.resourceGrants.net.has(pluginId, g.target)
        : hooks.resourceGrants.spawn.has(pluginId, g.target)
  const pending = requested.filter((g) => !alreadyGranted(g))
  let scope: 'persistent' | 'session' = 'persistent'
  if (pending.length > 0) {
    const isSystem = hooks.isSystemPlugin(pluginId)
    if (!isSystem) {
      const r = await hooks.confirmResource({
        type: 'batch',
        items: pending.map((g) => ({
          fromName: pluginId,
          targetName: pluginId,
          method: g.type === 'fs' ? `${mt('resource.category.fs')}：${fsRequestMethodText(g.modes)}` : g.type === 'net' ? mt('resource.category.net') : mt('resource.category.spawn'),
          resource: g.target,
          desc,
        })),
        canScope: true,
      })
      if (!r.allow) {
        // 拒绝粒度：已授权项默认放行（granted），仅未授权项进 denied
        return { granted: requested.filter((g) => alreadyGranted(g)).map((g) => g.target), denied: pending.map((g) => g.target) }
      }
      scope = r.scope
    }
    for (const g of pending) {
      if (g.type === 'fs') {
        // 只补授申请档位（幂等，不隐式扩档到未申请档位）
        for (const m of g.modes) {
          hooks.resourceGrants.fs.grant(pluginId, g.target, { mode: m, scope })
        }
      } else if (g.type === 'net') hooks.resourceGrants.net.grant(pluginId, g.target, { scope })
      else hooks.resourceGrants.spawn.grant(pluginId, g.target, { scope })
    }
  }
  return { granted: requested.map((g) => g.target), denied: [] }
}
