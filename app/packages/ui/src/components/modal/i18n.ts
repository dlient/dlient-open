/**
 * modal 的 i18n 翻译助手。
 *
 * 弹框是函数式 API（在 React 渲染上下文之外调用），不能直接用 useI18n() 的 context
 * t。这里基于 @dlient-open/i18n 的 store 单例快照自行解析，行为与 useI18n().t 一致
 * （key 格式 'namespace.path'；函数值传入 args 插值；未命中回退 key 本身）。
 *
 * - uiText：命令式，弹框打开时取当前语言（覆盖 close 按钮 aria-label 等静态文案）。
 * - useUiText：响应式 hook，经 useSyncExternalStore 订阅 store，语言切换时
 *   ModalFooter 会重新渲染，按钮默认文案实时跟随。
 */
import { useSyncExternalStore } from 'react'
import { store } from '@dlient-open/i18n'
import type { Locale, MessageValue, Resources } from '@dlient-open/i18n'

function resolveString(resources: Resources, locale: Locale, key: string, args: unknown[]): string {
  const dot = key.indexOf('.')
  let value: MessageValue | undefined
  if (dot >= 0) {
    const ns = key.slice(0, dot)
    const k = key.slice(dot + 1)
    value = resources[ns]?.[locale]?.[k]
  } else {
    for (const ns of Object.keys(resources)) {
      const dict = resources[ns][locale]
      if (dict && key in dict) {
        value = dict[key]
        break
      }
    }
  }
  if (typeof value === 'function') return value(...args)
  return value ?? key
}

export function uiText(key: string, ...args: unknown[]): string {
  const { resources, locale } = store.getSnapshot()
  return resolveString(resources, locale, key, args)
}

export function useUiText(): (key: string, ...args: unknown[]) => string {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return (key: string, ...args: unknown[]) => resolveString(snapshot.resources, snapshot.locale, key, args)
}
