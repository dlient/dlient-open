import React from 'react'
import type { RenderOptions } from './types'

// {{name}} 插值 → 纯字符串（数据层可用）
export function interpolate(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''))
}

// '<tag>text</tag>' 标记 → options.tag(text)，返回 ReactNode
export function renderRichText(text: string, options: RenderOptions): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /<([a-zA-Z0-9_-]+)>(.*?)<\/\1>/gs
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const [full, tag, inner] = match
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const render = options[tag]
    parts.push(typeof render === 'function' ? render(inner) : inner)
    lastIndex = match.index + full.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))

  return parts.length === 1 ? parts[0] : parts.map((p, i) => <React.Fragment key={i}>{p}</React.Fragment>)
}
