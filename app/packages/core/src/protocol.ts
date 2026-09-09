/**
 * Protocol - dlientOpen:// 自定义协议解析与磁盘映射（特权 scheme 配置须在 app.whenReady 前注册）。
 */

// URL scheme 大小写不敏感，代码内统一小写
export const PROTOCOL_NAME = 'dlientopen'

export function parseDlientUrl(url: string): { pluginId: string; path: string } | null {
  try {
    const urlObj = new URL(url)
    if (urlObj.protocol !== `${PROTOCOL_NAME}:`) {
      return null
    }
    if (urlObj.hostname !== 'plugin') {
      return null
    }
    const parts = urlObj.pathname.split('/').filter(Boolean)
    if (parts.length < 1) {
      return null
    }
    const pluginId = parts[0]
    const path = parts.slice(1).join('/') || 'index.html'
    return { pluginId, path }
  } catch {
    return null
  }
}

export function resolveDlientUrl(url: string, pluginRoot: string): string | null {
  const parsed = parseDlientUrl(url)
  if (!parsed) return null
  if (parsed.path.includes('..') || parsed.pluginId.includes('..')) {
    return null
  }
  return `${pluginRoot}/${parsed.pluginId}/${parsed.path}`
}

export function buildDlientUrl(pluginId: string, path: string = 'dist/remoteEntry.js'): string {
  return `${PROTOCOL_NAME}://plugin/${pluginId}/${path.startsWith('/') ? path.slice(1) : path}`
}

/** 特权 scheme 配置（必须在 app.whenReady() 之前调用 registerSchemesAsPrivileged） */
export function getProtocolConfig() {
  return {
    scheme: PROTOCOL_NAME,
    privileges: {
      standard: false,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }
}
