import type { ReactNode } from 'react'

export type Locale = 'zh-CN' | 'en-US'

// 翻译值：静态字符串 或 返回字符串的插值函数（保持纯数据、可跨进程）
// any[] 刻意保留：文案侧写成具体签名（如 (name: string) => string），在 strictFunctionTypes
// 下参数逆变，(...args: unknown[]) => string 无法接收，改 unknown 会让所有文案定义报错。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageValue = string | ((...args: any[]) => string)

// 命名空间 → 语言 → 文案；基座/插件通过 module augmentation 扩展
// 空接口即扩展点本身：使用方 declare module 往里补字段，不能替换为 Record/type
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TranslationMap {}

// 富文本渲染：占位标记 <tag> 对应的组件渲染回调
export type RenderCallback = (children: string) => ReactNode
export interface RenderOptions {
  [key: string]: unknown | RenderCallback
}

// tx 返回类型：单个节点或片段（ReactNode）
export type TxFunction = (key: string, options?: RenderOptions) => ReactNode

// 单个命名空间的语言包：locale → key → value
export type ResourceBundle = Record<Locale, Record<string, MessageValue>>
// 全局资源：namespace → ResourceBundle
export type Resources = Record<string, ResourceBundle>
