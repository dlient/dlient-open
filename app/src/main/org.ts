/**
 * org.ts - 插件组织标识判定 + 本地签名/验签（开源版）。
 *
 * 签名格式与闭源版完全一致（signature.json, format=1）：
 *   { format:1, id, version, files: { 'package.json': 'sha256:<hex>', 'dist/...': 'sha256:<hex>' }, sig }
 *   - files 仅含 package.json + dist/**（不含 dist/node_modules/）；assets/skills 不参与签名；
 *   - 规范化消息：dlient-signature:v1\n<id>\n<version>\n<path>=<hash>…（files 按路径字典序）；
 *   - 对 sha256(消息) 做 Ed25519 签名（hex）。
 *
 * 与闭源差异：不连服务端/无平台公钥——本机内置本地密钥对，安装时宿主签名、启动/加载时宿主验签。
 * 用途为完整性（防包文件被改/注入导致损坏），不做组织背书。@dev / 开发源码目录不受影响。
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { PluginSource } from '@dlient-open/core'

/** 本地签名公钥（SPKI DER base64；与下方私钥配对，随宿主内置，验签恒定可用） */
const LOCAL_PUBLIC_KEY_B64 =
  'MCowBQYDK2VwAyEARrA4UFGNwFUdhl8ThvELx2k5RathklTfBvoOSOlTNEQ='

/** 本地签名私钥（PKCS8 PEM；开源版本地完整性签名用，非组织背书） */
const LOCAL_PRIVATE_KEY_PEM =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIIZhaQKWIvo5iW9/8gFElCWgSvMMUINczr1OY2ohPMVf\n-----END PRIVATE KEY-----\n'

let signKey: KeyObject | undefined

function getSignKey(): KeyObject {
  if (!signKey) signKey = createPrivateKey(LOCAL_PRIVATE_KEY_PEM)
  return signKey
}

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

// ---- signature.json（本地完整性签名，格式与闭源一致）----

interface PkgSignatureFile {
  format?: number
  id?: string
  version?: string
  /** 相对插件根目录路径 → 'sha256:<hex>' */
  files?: Record<string, string>
  /** Ed25519 签名（hex） */
  sig?: string
}

/** 目录是否位于某个 dev 源码根之下（仓库根的直接子目录；命中 → 视为开发源码，跳过验签/不要求签名） */
function isUnderDevSource(dir: string, roots: string[] | undefined): boolean {
  if (!roots || roots.length === 0) return false
  const n = dir.replace(/[\\/]+$/, '')
  return roots.some((r) => {
    const root = String(r).replace(/[\\/]+$/, '')
    return n === root || n.startsWith(root + sep)
  })
}

/** 规范化签名消息：dlient-signature:v1\n<id>\n<version>\n<path>=<hash>...（files 按路径字典序） */
function buildSignatureMessage(id: string, version: string, files: Record<string, string>): Buffer {
  const lines: string[] = ['dlient-signature:v1', id, version]
  for (const path of Object.keys(files).sort()) {
    lines.push(`${path}=${files[path]}`)
  }
  return Buffer.from(lines.join('\n'), 'utf-8')
}

/** 递归收集 dist/ 下的文件相对路径（跳过 node_modules），用于签名清单与封闭性比对 */
function collectDistFiles(dir: string): string[] {
  const out: string[] = []
  const subDir = join(dir, 'dist')
  if (!existsSync(subDir)) return out
  const walk = (base: string): void => {
    let entries
    try {
      entries = readdirSync(join(subDir, base), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules') continue
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) walk(rel)
      else if (e.isFile()) out.push(`dist/${rel}`)
    }
  }
  walk('')
  return out
}

/** sha256:<hex> 条目构建：package.json + dist/**（与闭源签名范围一致） */
function buildFilesManifest(dir: string): Record<string, string> {
  const rels = ['package.json', ...collectDistFiles(dir)]
  const files: Record<string, string> = {}
  for (const rel of rels) {
    try {
      files[rel] = `sha256:${createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')}`
    } catch {
      /* 缺失文件跳过（签名前目录应完整） */
    }
  }
  return files
}

/**
 * 本地签名插件目录（安装落盘后调用，写入 signature.json，format 与闭源一致）。
 * dir 需已含改写后的 package.json（source=local / system=false）与完整 dist。
 */
export async function signPluginForDir(dir: string, id: string, version: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const files = buildFilesManifest(dir)
    if (!files['package.json']) return { ok: false, error: 'sign: package.json missing' }
    const message = buildSignatureMessage(id, version, files)
    const digest = createHash('sha256').update(message).digest()
    const sig = sign(null, digest, getSignKey()).toString('hex')
    const payload: PkgSignatureFile = { format: 1, id, version, files, sig }
    await writeFile(join(dir, 'signature.json'), JSON.stringify(payload, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 校验插件 signature.json（算法/格式与闭源版一致）：
 * 1) format=1 / id / version / files / sig 合法；
 * 2) 清单内文件 SHA-256 与磁盘一致；
 * 3) dist/ 封闭性双向比对（跳过 node_modules，防注入/缺文件）；
 * 4) 内置公钥 Ed25519 验签（sha256(规范化消息)）。
 */
export async function verifyPkgSignature(dir: string): Promise<boolean> {
  let raw: string
  try {
    raw = readFileSync(join(dir, 'signature.json'), 'utf-8')
  } catch {
    return false
  }
  let sig: PkgSignatureFile
  try {
    sig = JSON.parse(raw) as PkgSignatureFile
  } catch {
    return false
  }
  if (
    sig.format !== 1 ||
    typeof sig.id !== 'string' ||
    typeof sig.version !== 'string' ||
    !sig.files ||
    typeof sig.files !== 'object' ||
    typeof sig.sig !== 'string'
  ) {
    return false
  }
  // 1) 清单内文件 hash 比对
  for (const [rel, expected] of Object.entries(sig.files)) {
    const hex = typeof expected === 'string' && expected.startsWith('sha256:') ? expected.slice('sha256:'.length) : ''
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return false
    let fileHash: string
    try {
      fileHash = createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')
    } catch {
      return false
    }
    if (fileHash !== hex.toLowerCase()) return false
  }
  // 2) dist/ 封闭性：实际文件集合 == 清单 dist 条目（跳过 node_modules）
  const listed = new Set<string>()
  for (const rel of Object.keys(sig.files)) if (rel.startsWith('dist/')) listed.add(rel)
  const actual = new Set(collectDistFiles(dir))
  for (const rel of actual) if (!listed.has(rel)) return false
  for (const rel of listed) if (!actual.has(rel)) return false
  // 3) 本地公钥验签
  try {
    const key = createPublicKey({ key: Buffer.from(LOCAL_PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki' })
    const message = buildSignatureMessage(sig.id, sig.version, sig.files)
    const digest = createHash('sha256').update(message).digest()
    return verify(null, digest, key, Buffer.from(sig.sig, 'hex'))
  } catch {
    return false
  }
}

/** 读取 signature.json 身份元信息（format/id/version）；文件缺失或格式非法返回 null */
export function readPkgSignatureMeta(dir: string): { format: number; id: string; version: string } | null {
  try {
    const raw = readFileSync(join(dir, 'signature.json'), 'utf-8')
    const sig = JSON.parse(raw) as PkgSignatureFile
    if (sig.format !== 1 || typeof sig.id !== 'string' || typeof sig.version !== 'string') return null
    return { format: sig.format, id: sig.id, version: sig.version }
  } catch {
    return null
  }
}

/**
 * 启动/加载前插件包校验：
 * - dev 源码目录（devSourceDirs）→ ok（@dev 不受签名影响）；
 * - 无 signature.json（历史导入的未签名包）→ 放行并记录（本地签名自本版本起在安装时写入）；
 * - 有 signature.json → 身份核对（sig.id === expectId）+ verifyPkgSignature；任一失败 → 拒绝。
 */
export async function verifyPluginPackageStartable(
  dir: string,
  expectId: string,
  opts: { devSourceDirs?: string[]; allowNoKey?: boolean; requireSigned?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (isUnderDevSource(dir, opts.devSourceDirs)) return { ok: true }
  const sigPath = join(dir, 'signature.json')
  if (!existsSync(sigPath)) {
    // 历史未签名包放行（维持存量不锁死）；本版本起所有新安装都会写入 signature.json
    return { ok: true }
  }
  const meta = readPkgSignatureMeta(dir)
  if (!meta) return { ok: false, error: 'signature.json malformed' }
  if (meta.id !== expectId) {
    return { ok: false, error: `signature id mismatch (expected ${expectId}, got ${meta.id})` }
  }
  const ok = await verifyPkgSignature(dir)
  if (ok) return { ok: true }
  return { ok: false, error: 'integrity check failed (file modified, unlisted file injected, or signature invalid)' }
}

/** 启动早期预热（本地公钥内嵌，无需预热）：空实现保留调用点兼容 */
export async function warmupPlatformKey(): Promise<void> {
  /* 本地签名，无需预热 */
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
