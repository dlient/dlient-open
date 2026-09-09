import * as React from 'react'

export interface PluginIconProps {
  /** 插件 id（用于 dlientOpen://plugin/<id>/<icon> 资源定位） */
  pluginId: string
  /** 插件图标（manifest dlient.icon）：相对插件根目录路径字符串；缺省显示兜底首字母 */
  icon?: string
  /** 图标缺失 / 加载失败时的兜底首字母来源 */
  name?: string
  /** 尺寸（宽高，px），默认 36 */
  size?: number
  /** 激活态：默认 true（图标原色展示）；显式传 false 时图标以 50% 透明度渲染（未激活/置灰语义） */
  active?: boolean
  className?: string
}

/**
 * PluginIcon - 插件图标。
 * 统一以 <img> 渲染（svg/png 均原色展示）；资源加载失败时回退为名称首字母。
 * active 默认 true；active=false 时 <img> 透明度 50%。
 */
export function PluginIcon({ pluginId, icon, name = '', size = 36, active = true, className }: PluginIconProps) {
  const [failed, setFailed] = React.useState(false)
  // 图标资源定位：http(s) 绝对 URL（服务端图标）直接用；相对路径走 dlientOpen 协议
  const url = icon && !failed
    ? /^https?:\/\//i.test(icon)
      ? icon
      : `dlientOpen://plugin/${pluginId}/${icon}`
    : null
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: active ? 1 : 0.5 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span style={{ fontSize: size * 0.36, fontWeight: 600, lineHeight: 1 }}>
          {(typeof name === 'string' && name ? name : pluginId || '?').slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  )
}
