/**
 * css-scope.ts - 插件 CSS 作用域 PostCSS 插件（docs/specs/plugin-css-scope.md）。
 *
 * 把插件产物 CSS 的每条选择器改写为 `[data-plugin="<pluginId>"] :where(原选择器)`：
 *  - 前缀锚点与 PluginView 根容器 / body 级 portal 容器共用（pluginScopeId，剥掉 '@dev' 保持一致）；
 *  - `:where` 前缀特异性为 0，不干扰插件内部选择器权重；
 *  - `@media / @supports` 等 at-rule 内部规则同样改写（walkRules 递归）；
 *  - `@keyframes` 名称加 `<pluginId>-` 前缀，并同步改写 `animation` / `animation-name` 引用；
 *  - `:global(...)` / 白名单选择器保留原样（显式逃逸）；
 *  - `html / body / :root / *` 等页面级选择器改写为指向插件根容器，不真正命中页面级元素。
 */

import type { Root, Rule, AtRule, Declaration } from 'postcss'
import type { PluginCreator } from 'postcss'

export interface CssScopeOptions {
  /** 插件 id（manifest.dlient.id，与运行时 data-plugin 锚点一致） */
  pluginId: string
  /** 白名单选择器（整条保留原样，显式逃逸） */
  keep?: string[]
}

/** 顶层逗号切分（识别属性选择器 / 函数括号 / 字符串，避免误切 `[data-x="a,b"]`、`:not(a, b)`） */
function splitTopLevel(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (quote) {
      cur += ch
      if (ch === quote && selector[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

/** 页面级起始复合：html / body / :root 后跟空白或组合器，或单独成条 */
const PAGE_LEVEL_START = /^(html|body|:root)([\s+~>]|$)/i

/** 单条选择器作用域化 */
function scopeSelector(sel: string, anchor: string, keep: Set<string>): string {
  const trimmed = sel.trim()
  if (!trimmed) return sel
  if (keep.has(trimmed)) return trimmed
  // :global(...) / :local(...) 保留原样（显式逃逸）：vite CSS Modules 在其处理链中解释
  // `:global(.x)` → `.x`（全局）；普通 .css 里若出现属误用，按原样输出不强行改写。
  if (trimmed.startsWith(':global(') || trimmed.startsWith(':local(') || trimmed === ':global' || trimmed === ':local') return trimmed
  // 页面级（html/body/:root 起始）：剥掉页面级复合，指向插件根容器（不再命中页面级元素）
  let rest = trimmed
  if (PAGE_LEVEL_START.test(rest)) {
    rest = rest.replace(PAGE_LEVEL_START, (_m, _p, sep) => sep || ' ').trim()
    if (!rest) return anchor
  }
  return `${anchor} :where(${rest})`
}

/** @keyframes 帧规则（from/to/百分比的子 rule）不参与作用域化 */
function isKeyframesFrame(parent: AtRule | Rule | undefined): boolean {
  return !!parent && parent.type === 'atrule' && /^keyframes$/i.test(String((parent as AtRule).name ?? ''))
}

export const cssScope: PluginCreator<CssScopeOptions> = (opts) => {
  const pluginId = opts?.pluginId ?? ''
  const anchor = `[data-plugin="${pluginId}"]`
  const keep = new Set((opts?.keep ?? []).map((s) => s.trim()).filter(Boolean))
  const keyframes = new Map<string, string>()

  return {
    postcssPlugin: 'dlient-css-scope',
    OnceExit(root: Root): void {
      // 1) @keyframes 改名 + 收集映射
      root.walkAtRules((atRule) => {
        if (!/^keyframes$/i.test(atRule.name)) return
        const name = String(atRule.params ?? '').trim()
        if (!name) return
        const prefixed = `${pluginId}-${name}`
        keyframes.set(name, prefixed)
        atRule.params = prefixed
      })
      // 2) animation / animation-name 引用同步改写
      if (keyframes.size > 0) {
        root.walkDecls((decl) => {
          const prop = String(decl.prop).toLowerCase()
          if (prop !== 'animation' && prop !== 'animation-name') return
          decl.value = String(decl.value).replace(/\w[-\w]*/g, (token) => keyframes.get(token) ?? token)
        })
      }
      // 3) 规则选择器作用域化（walkRules 递归覆盖 @media/@supports 内规则）
      root.walkRules((rule) => {
        if (isKeyframesFrame(rule.parent as AtRule | Rule | undefined)) return
        const scoped = splitTopLevel(rule.selector).map((s) => scopeSelector(s, anchor, keep)).join(', ')
        if (scoped !== rule.selector) rule.selector = scoped
      })
    },
  }
}

/** postcss 函数式插件标记：调用后返回带 postcssPlugin 的对象 */
cssScope.postcss = true
