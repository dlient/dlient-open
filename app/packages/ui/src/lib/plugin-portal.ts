/**
 * plugin-portal.ts - 插件 CSS 作用域锚点工具（docs/specs/plugin-css-scope.md）。
 *
 * 插件 UI 运行在宿主共享渲染进程：每个插件视图在根容器挂 `data-plugin="<scopeId>"`，
 * 弹层（Radix Portal）默认落到 body 下的 `<div data-plugin="<scopeId>" data-plugin-portal="true">`，
 * 根子树与弹层子树共用同一属性值 → 构建期 PostCSS 前缀选择器
 * `[data-plugin="<pluginId>"] :where(...)` 一条规则同时覆盖两者。
 *
 * scopeId 取插件「基座 id」（剥掉 '@dev'）：dev 实例与正式实例同源同构建产物，
 * 构建期写死的 pluginId 与运行时锚点保持一致。
 */
import { useContext } from 'react'
import { PluginApiContext } from '@dlient-open/api-bridge'

/** 作用域 id：基座 id（dev 实例 '<id>@dev' → '<id>'；其余原样） */
export function pluginScopeId(pluginId: string): string {
  return pluginId.endsWith('@dev') ? pluginId.slice(0, -4) : pluginId
}

/** 查找/创建 body 级插件 portal 容器（按 scopeId 复用；幂等） */
export function ensurePluginPortalContainer(pluginId: string): HTMLDivElement {
  const scopeId = pluginScopeId(pluginId)
  const existing = Array.from(document.body.children).find(
    (el): el is HTMLDivElement =>
      el.tagName === 'DIV' && el.getAttribute('data-plugin') === scopeId && el.getAttribute('data-plugin-portal') === 'true',
  )
  if (existing) return existing
  const div = document.createElement('div')
  div.setAttribute('data-plugin', scopeId)
  div.setAttribute('data-plugin-portal', 'true')
  document.body.appendChild(div)
  return div
}

/** 当前插件作用域 id（非插件上下文 → undefined；Radix Portal container 缺省时回落 document.body） */
export function usePluginScopeId(): string | undefined {
  const api = useContext(PluginApiContext)
  if (!api || typeof api.pluginId !== 'string') return undefined
  return pluginScopeId(api.pluginId)
}

/** 当前插件 portal 容器（非插件上下文 → undefined） */
export function usePluginPortalContainer(): HTMLDivElement | undefined {
  const scopeId = usePluginScopeId()
  if (!scopeId) return undefined
  return ensurePluginPortalContainer(scopeId)
}
