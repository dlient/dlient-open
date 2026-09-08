/**
 * org.ts - 插件组织标识判定（开源版）。
 *
 * 开源版无服务端、无登录、无签名：organization 仅作为 manifest 元信息直接透出，
 * 不做任何用户组织校验 / 平台公钥验签 / signature.json 校验。
 * 插件由用户自己负责，宿主不进行完整性背书。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginSource } from '@dlient-open/core'

export interface OrgLocateResult {
  /** 插件根目录绝对路径（含 package.json） */
  path: string
  source: PluginSource
}

export interface OrgService {
  /** 开源版无登录组织：占位保留接口，直接置空（调用方仍可安全调用） */
  setUserOrgs(orgs: string[]): void
  /** 解析插件组织标识（'@xxx'）；无组织 → null（不做任何校验） */
  resolveOrg(pluginId: string): Promise<string | null>
}

/** 从插件 package.json 读取 manifest 组织标识（'@xxx'；无 / 非字符串 → null） */
function readManifestOrganization(dir: string): string | null {
  try {
    const pkg = JSON.parse(String(readFileSync(join(dir, 'package.json'), 'utf-8')).replace(/^\uFEFF/, '')) as {
      dlient?: { organization?: unknown }
    }
    const org = pkg.dlient?.organization
    return typeof org === 'string' && org.trim() ? org : null
  } catch {
    return null
  }
}

/**
 * 启动/加载前插件包校验（开源版）：不校验签名，一律放行。
 * 保留函数签名以便调用方（runtime / 协议闸）无需改动。
 */
export async function verifyPluginPackageStartable(
  _dir: string,
  _expectId: string,
  _opts: { devSourceDirs?: string[]; allowNoKey?: boolean; requireSigned?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  return { ok: true }
}

/** 启动早期预热（开源版无平台公钥概念）：空实现 */
export async function warmupPlatformKey(): Promise<void> {
  /* 无服务端、无签名，无需预热 */
}

export function createOrgService(opts: { locate: (pluginId: string) => OrgLocateResult | null }): OrgService {
  async function resolveOrg(pluginId: string): Promise<string | null> {
    const located = opts.locate(pluginId)
    if (!located) return null
    return readManifestOrganization(located.path)
  }

  return {
    setUserOrgs: () => {
      /* 开源版无登录组织，忽略 */
    },
    resolveOrg,
  }
}
