/**
 * grants.ts - 主进程授权表（docs/v3/plugin-view.md §2.4 / §7）。
 *
 * 职责：
 *  - 存放入口调用授权（install-confirm 永久 / runtime-confirm 1 天有效）；
 *  - userData/grants.json **加密写入**（复用 master_key 体系，encryptHost/decryptHost）；
 *  - 内存常驻一份明文，**仅在变更时（grant / revoke / 过期清理）才加密写盘**；
 *  - 仅主进程可读写（渲染层无法伪造"已授权"）。
 *
 * 记录粒度：{ grantee, target, method, grantedAt, expiresAt }（expiresAt=null 表示永久）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { encryptHost, decryptHost } from './crypt'

export interface Grant {
  grantee: string
  target: string
  method: string
  grantedAt: number
  /** null = 永久（install-confirm / 始终允许）；否则为过期时间戳 */
  expiresAt: number | null
}

export class GrantStore {
  private file: string
  private grants = new Map<string, Grant>()
  private dirty = false
  private loaded = false

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'grants.json')
  }

  /** 启动时加载（解密；损坏视为空表并重建） */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.file, 'utf-8')
      const json = await decryptHost(raw.trim())
      const list = JSON.parse(json) as Grant[]
      if (!Array.isArray(list)) throw new Error('grants: invalid payload')
      for (const g of list) {
        if (!g || typeof g.grantee !== 'string' || typeof g.target !== 'string' || typeof g.method !== 'string') continue
        this.grants.set(grantKey(g.grantee, g.target, g.method), g)
      }
      this.purgeExpired()
    } catch {
      // 文件缺失 / 解密失败（损坏）：视为空授权表，等待下次变更重建
      this.grants.clear()
    }
  }

  /** 是否存在未过期的授权（canInvoke confirm 档查询用；同步） */
  has(grantee: string, target: string, method: string): boolean {
    const g = this.grants.get(grantKey(grantee, target, method))
    if (!g) return false
    if (g.expiresAt !== null && g.expiresAt <= Date.now()) {
      // 惰性清理过期项
      this.grants.delete(grantKey(grantee, target, method))
      this.markDirty()
      return false
    }
    return true
  }

  /** 写入授权（install-confirm 传 null；runtime-confirm 传 now + 1d） */
  grant(grantee: string, target: string, method: string, expiresAt: number | null): void {
    this.grants.set(grantKey(grantee, target, method), {
      grantee,
      target,
      method,
      grantedAt: Date.now(),
      expiresAt,
    })
    this.markDirty()
  }

  /** 撤销某插件相关的全部授权（卸载 / 覆盖安装时调用：grantee 或 target 命中即清） */
  revokeByPlugin(pluginId: string): void {
    let changed = false
    for (const [key, g] of this.grants) {
      if (g.grantee === pluginId || g.target === pluginId) {
        this.grants.delete(key)
        changed = true
      }
    }
    if (changed) this.markDirty()
  }

  /** 清理过期授权（仅内存 + 标记；不强制立即落盘） */
  private purgeExpired(): void {
    const now = Date.now()
    for (const [key, g] of this.grants) {
      if (g.expiresAt !== null && g.expiresAt <= now) {
        this.grants.delete(key)
        this.dirty = true
      }
    }
  }

  private markDirty(): void {
    this.dirty = true
    // 仅变更时才加密写盘（异步，失败不阻塞调用方；下次变更重试）
    void this.persist().catch(() => undefined)
  }

  /** 加密写盘（仅 dirty 时执行；写失败仅记录，下次变更重试） */
  private async persist(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    const payload = Array.from(this.grants.values())
    const b64 = await encryptHost(JSON.stringify(payload))
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, b64, 'utf-8')
  }

  /** 测试/调试：当前授权条数 */
  size(): number {
    return this.grants.size
  }
}

function grantKey(grantee: string, target: string, method: string): string {
  return `${grantee}|${target}|${method}`
}
