import compiledCss from '../../styles/ui.css?inline'

let ensured = false

/**
 * 幂等注入 @dlient-open/ui 自包含样式（shadcn 变量层 :root/.dark + 预编译 tailwind 工具类）。
 * 宿主/插件共享同一份 @dlient-open/ui 单实例，注入一次全局可用；
 * 本包样式不再引用宿主 tokens.css 的 --dlient-* 变量。
 */
export function ensureUiStyles(): void {
  if (ensured || typeof document === 'undefined') return
  ensured = true
  if (document.getElementById('dui:shadcn-style')) return
  const el = document.createElement('style')
  el.id = 'dui-shadcn-style'
  el.textContent = compiledCss
  document.head.appendChild(el)
}

/** @deprecated 兼容曾用名（样式注入已统一为 ensureUiStyles） */
export const ensureUiPrimitiveStyles = ensureUiStyles
