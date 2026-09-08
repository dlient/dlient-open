/**
 * lib/net.ts - 端口工具 + 出站网络策略（内网/回环 SSRF 收口；api/net.ts 引用）。
 */
import { createConnection, createServer } from 'node:net'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/** 分配空闲端口（宿主绑定 0 → 释放返回；替代 worker 内 node:net 分配；api/net.ts 使用） */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0))
    })
  })
}

/** 端口就绪探测（本机 TCP connect；替代 worker 内 fetch('http://127.0.0.1:port')；api/net.ts 使用） */
export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    sock.setTimeout(800)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
  })
}

/* ------------------------------------------------------------------ */
/* 出站网络策略（SSRF 收口）：默认拒绝内网/回环，云 metadata 无条件硬禁  */
/* ------------------------------------------------------------------ */

export interface NetPolicy {
  /** 目标属内网/回环/链路本地/ULA 等（需授权例外） */
  internal: boolean
  /** 云 metadata / 广播等绝对高危，任何插件任何授权都不放行 */
  hardDenied: boolean
  host: string
}

/** IPv4 字符串 → 32 位无符号整数（非 IPv4 返回 null） */
function v4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = m.slice(1).map(Number)
  if (o.some((n) => n > 255)) return null
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
}

/** 单个 IP 判级：'hard' | 'internal' | 'public' */
function classifyIp(ip: string): 'hard' | 'internal' | 'public' {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, '')
  // IPv4-mapped IPv6（::ffff:a.b.c.d）转 v4 再判
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return classifyIp(mapped[1])
  const v4 = v4ToInt(a)
  if (v4 !== null) {
    if (a === '169.254.169.254' || a === '255.255.255.255' || a === '0.0.0.0') return 'hard' // 云 metadata / 广播 / 通配
    if ((v4 >>> 24) === 127) return 'internal' // 回环
    if ((v4 >>> 24) === 10) return 'internal'
    if ((v4 >>> 24) === 172 && (v4 >>> 16 & 0xff) >= 16 && (v4 >>> 16 & 0xff) <= 31) return 'internal'
    if ((v4 >>> 24) === 192 && (v4 >>> 16 & 0xff) === 168) return 'internal'
    if ((v4 >>> 24) === 169 && (v4 >>> 16 & 0xff) === 254) return 'internal' // 链路本地（metadata 已在上方 hard）
    if ((v4 >>> 24) === 100 && (v4 >>> 16 & 0xff) >= 64 && (v4 >>> 16 & 0xff) <= 127) return 'internal' // CGNAT
    if ((v4 >>> 24) >= 224) return 'hard' // 组播/保留段不放行
    return 'public'
  }
  // IPv6：回环 / ULA(fc00::/7) / 链路本地(fe80::/10)
  if (a === '::1') return 'internal'
  if (a.startsWith('fc') || a.startsWith('fd')) return 'internal'
  if (/^fe[89ab]/.test(a)) return 'internal'
  if (a.startsWith('ff')) return 'hard' // 组播
  return 'public'
}

/**
 * 出站 URL 网络策略：解析 hostname（字面 IP 直接用；域名异步 DNS 解析取地址），
 * 任一路由为 hard → hardDenied；否则任一 internal 视为 internal。
 */
export async function evaluateNetPolicy(rawUrl: string): Promise<NetPolicy> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { internal: false, hardDenied: false, host: '' } // 非法 URL：交由后续授权/请求自身报错
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const literal = isIP(host)
  let addrs: string[] = []
  if (literal === 4 || literal === 6) {
    addrs = [host]
  } else {
    try {
      const r = await lookup(host, { verbatim: true })
      addrs = Array.isArray(r) ? r.map((x) => x.address) : [r.address]
    } catch {
      addrs = [] // 解析失败不判内网（后续请求自然失败）；域名可能后续才解析——见备注
    }
  }
  let verdict: 'hard' | 'internal' | 'public' = 'public'
  for (const a of addrs) {
    const c = classifyIp(a)
    if (c === 'hard') {
      verdict = 'hard'
      break
    }
    if (c === 'internal' && verdict === 'public') verdict = 'internal'
  }
  return { internal: verdict === 'internal', hardDenied: verdict === 'hard', host }
}
