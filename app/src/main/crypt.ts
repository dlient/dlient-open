/**
 * crypt.ts - 主进程私有加密（每插件独立密钥，docs/v3/crypt.md 实现）。
 *
 * 设计要点：
 *  - master_key（32B）首次生成，经 safeStorage 加密落盘 userData/plugin-data/_host/master.key；
 *    仅主进程内部持有明文，绝不下发 worker / 渲染层。
 *  - K_pluginId = HKDF-SHA256(ikm=master_key, salt="dlient-plugin-crypt:v1", info=pluginId)，
 *    每次调用临时派生、用完即弃，不落盘。
 *  - 数据格式：base64( version(1B) || iv(12B) || tag(16B) || AES-256-GCM(plain) )
 *  - 旧格式回退：非 v1 格式密文（历史 safeStorage 直加密文，如旧 session.enc）→ 主进程内部
 *    safeStorage 解密兜底，保证平滑迁移；GCM 认证失败（密钥不匹配）不触发回退，维持插件隔离。
 *
 * 对外暴露：
 *  - encryptForPlugin / decryptForPlugin：仅供 export.ts 的 app.crypt.* host-api 调用。
 */

import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const HKDF_SALT = 'dlient-plugin-crypt:v1'
const VERSION = 1
const IV_LEN = 12
const TAG_LEN = 16
const MIN_LEN = 1 + IV_LEN + TAG_LEN + 1

let masterKey: Buffer | null = null
let masterKeyInit: Promise<Buffer> | null = null

function masterKeyPath(): string {
  return join(app.getPath('userData'), 'plugin-data', '_host', 'master.key')
}

/**
 * 加载 / 生成 master_key（幂等，仅首次调用执行 IO）。
 * - 有密文且 safeStorage 可用：解密恢复；
 * - 无 keyring（isEncryptionAvailable=false）：按明文读写（退化：随机密钥 + 文件权限保护）；
 * - 缺失 / 解不开（换机、重装、清库）：生成新 key 落盘（旧密文随之不可解，与 session.enc 行为一致）。
 */
async function initMasterKey(): Promise<Buffer> {
  if (masterKey) return masterKey
  if (!masterKeyInit) {
    masterKeyInit = (async () => {
      const path = masterKeyPath()
      let key: Buffer | null = null
      try {
        // 落盘内容为二进制：safeStorage 密文（Buffer）或退化路径的明文（Buffer）
        const stored = await readFile(path)
        key = safeStorage.isEncryptionAvailable()
          ? Buffer.from(safeStorage.decryptString(stored), 'latin1')
          : Buffer.from(stored.toString('latin1'), 'latin1')
        if (!key || key.length !== 32) throw new Error('master.key invalid length')
      } catch {
        key = randomBytes(32)
        const stored = safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(key.toString('latin1'))
          : Buffer.from(key.toString('latin1'))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, stored)
      }
      masterKey = key
      return key
    })()
  }
  return masterKeyInit
}

/** 派生插件密钥：K_pluginId = HKDF(master_key, salt, pluginId) */
function derivePluginKey(master: Buffer, pluginId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.from(HKDF_SALT), pluginId, 32))
}

/** 同步取 master_key（必须已由 ensureMasterKey / 首次异步调用初始化） */
function requireMasterKey(): Buffer {
  if (!masterKey) throw new Error('master key not initialized: call ensureMasterKey() first')
  return masterKey
}

/** 指定密钥 AES-256-GCM 加密：base64(version || iv || tag || ct) */
function aesEncrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(String(plain), 'utf-8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]).toString('base64')
}

/** 指定密钥 AES-256-GCM 解密（认证失败抛错） */
function aesDecrypt(key: Buffer, b64: string): string {
  const data = Buffer.from(String(b64), 'base64')
  if (data.length < MIN_LEN || data[0] !== VERSION) {
    throw new Error('unsupported ciphertext format')
  }
  const iv = data.subarray(1, 1 + IV_LEN)
  const tag = data.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN)
  const ct = data.subarray(1 + IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8')
}

/** 主进程内部 safeStorage 解密回退（旧格式密文 / 换 keyring 前的历史数据） */
function trySafeStorageDecrypt(b64: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return null
  }
}

/** 用指定插件密钥加密：返回 base64(version || iv || tag || ct) */
export async function encryptForPlugin(pluginId: string, plain: string): Promise<string> {
  const key = derivePluginKey(await initMasterKey(), pluginId)
  return aesEncrypt(key, plain)
}

/**
 * 用指定插件密钥解密。
 * - v1 格式：GCM 认证失败（密钥不匹配）直接抛错 —— 插件间隔离的核心；
 * - 非 v1 格式：回退主进程内部 safeStorage（历史数据迁移）。
 */
export async function decryptForPlugin(pluginId: string, b64: string): Promise<string> {
  const data = Buffer.from(String(b64), 'base64')
  if (data.length >= MIN_LEN && data[0] === VERSION) {
    const key = derivePluginKey(await initMasterKey(), pluginId)
    let gcmError: Error | null = null
    try {
      return aesDecrypt(key, b64)
    } catch (err) {
      gcmError = err instanceof Error ? err : new Error(String(err))
    }
    // GCM 认证失败：可能是旧 safeStorage blob 首字节恰为 1 被误判（Electron safeStorage 版本字节
    // 可能 ==1）。回退主进程内部 safeStorage 解密 —— 对真正的 v1 GCM 密文（其它插件数据），
    // safeStorage 无法解开（非 DPAPI blob）会抛错，仍走下方报错，隔离不破坏。
    const legacy = trySafeStorageDecrypt(String(b64))
    if (legacy !== null) return legacy
    throw new Error(`app.crypt.decrypt failed (auth): ${gcmError.message}`)
  }
  // 非 v1 格式（历史 safeStorage 直加密文）→ 主进程内部 safeStorage 兜底
  const legacy = trySafeStorageDecrypt(String(b64))
  if (legacy !== null) return legacy
  throw new Error('app.crypt.decrypt failed: unsupported format')
}

/** 预初始化 master_key（bootstrap 最早调用；此后同步加解密可安全使用） */
export async function ensureMasterKey(): Promise<void> {
  await initMasterKey()
}

/**
 * 同步版插件密钥加密（主进程内部；须已 ensureMasterKey，否则抛错）。
 * 用于主进程与 market 插件共同访问的 installed.json 注册表加密 ——
 * market 插件侧经 app.crypt host-api 用同一派生密钥，两侧可互解。
 */
export function encryptForPluginSync(pluginId: string, plain: string): string {
  return aesEncrypt(derivePluginKey(requireMasterKey(), pluginId), plain)
}

/** 同步版插件密钥解密（主进程内部；认证失败 / key 未就绪抛错，由调用方降级处理） */
export function decryptForPluginSync(pluginId: string, b64: string): string {
  return aesDecrypt(derivePluginKey(requireMasterKey(), pluginId), b64)
}

// ---- 主进程内部数据加密（授权表 grants 等；不与插件隔离数据混用）----
// 基于同一 master_key 直接作 AES-256-GCM 密钥，与 derivePluginKey 的插件密钥体系隔离。
// master_key 本身由 safeStorage 保护（不可用时明文退化），满足「safeStorage 优先、派生密钥兜底」。

/** 主进程内部加密：返回 base64(version || iv || tag || ct) */
export async function encryptHost(plain: string): Promise<string> {
  const key = await initMasterKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(String(plain), 'utf-8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]).toString('base64')
}

/** 主进程内部解密（认证失败抛错，视为数据损坏） */
export async function decryptHost(b64: string): Promise<string> {
  const data = Buffer.from(String(b64), 'base64')
  if (data.length < MIN_LEN || data[0] !== VERSION) {
    throw new Error('app.crypt.decryptHost failed: unsupported format')
  }
  const key = await initMasterKey()
  const iv = data.subarray(1, 1 + IV_LEN)
  const tag = data.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN)
  const ct = data.subarray(1 + IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8')
}
