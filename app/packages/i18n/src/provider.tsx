/**
 * Provider 与配套 hook 同文件共置：useI18n 依赖模块私有的 I18nContext，
 * 拆分需把 context 提成第三个文件并对外暴露，反而扩大了可误用的公开面。
 * 代价仅为本文件在 HMR 时退化为整页刷新。
 */
/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import { store } from './store'
import { interpolate, renderRichText } from './render'
import type { Locale, MessageValue, RenderOptions, Resources, TxFunction } from './types'

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, ...args: unknown[]) => string | React.ReactNode
  tx: TxFunction
}

const I18nContext = React.createContext<I18nContextValue | undefined>(undefined)

// key 格式：'namespace.path'；解析出 namespace 与真正的 key
function resolveMessage(resources: Resources, locale: Locale, key: string): MessageValue | undefined {
  const dot = key.indexOf('.')
  if (dot >= 0) {
    const ns = key.slice(0, dot)
    const k = key.slice(dot + 1)
    const dict = resources[ns]?.[locale]
    if (dict && k in dict) return dict[k]
    return undefined
  }
  // 无 namespace：在所有命名空间里查找
  for (const ns of Object.keys(resources)) {
    const dict = resources[ns][locale]
    if (dict && key in dict) return dict[key]
  }
  return undefined
}

function resolveString(resources: Resources, locale: Locale, key: string, args: unknown[]): string {
  const value = resolveMessage(resources, locale, key)
  if (typeof value === 'function') return value(...args)
  return value ?? key
}

/**
 * t 的统一解析（tx 能力合一）：{{key}} 插值 + <tag> 富文本渲染。
 * 文案含富文本标记 <tag>...</tag> → 渲染为 ReactNode（开发者只需调用 t）；
 * 否则返回纯字符串，兼容既有 string 上下文用法（MessagePlugin / join / string prop 等）。
 */
function resolveNode(resources: Resources, locale: Locale, key: string, args: unknown[]): string | React.ReactNode {
  const value = resolveMessage(resources, locale, key)
  if (typeof value === 'function') return value(...args)
  const options = (args.find((a) => typeof a === 'object' && a !== null) ?? {}) as RenderOptions
  const text = interpolate(value ?? key, options)
  return /<([a-zA-Z0-9_-]+)>[\s\S]*?<\/\1>/.test(text) ? renderRichText(text, options) : text
}

interface I18nProviderProps {
  children: React.ReactNode
}

export function I18nProvider({ children }: I18nProviderProps) {
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot)

  const value = React.useMemo<I18nContextValue>(() => ({
    locale: snapshot.locale,
    setLocale: (locale: Locale) => store.setLocale(locale),
    t: (key: string, ...args: unknown[]) => resolveNode(snapshot.resources, snapshot.locale, key, args),
    tx: (key: string, options: RenderOptions = {}) => {
      const raw = resolveString(snapshot.resources, snapshot.locale, key, [])
      return renderRichText(interpolate(raw, options), options)
    },
  }), [snapshot])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = React.useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
