/**
 * api/clipboard.ts - clipboard 模块 host-api（scope=all；level 按读/写）。
 */
import { clipboard, nativeImage } from 'electron'
import type { ApiDefinition } from './types'

type CbType = 'selection' | 'clipboard' | undefined

const READ: ApiDefinition[] = [
  {
    key: 'clipboard.readText',
    description: { 'zh-CN': '读取剪贴板纯文本', 'en-US': 'Read clipboard text' },
    scope: 'all',
    level: 'warn',
    handler: () => clipboard.readText(),
  },
  {
    key: 'clipboard.readHTML',
    description: { 'zh-CN': '读取剪贴板 HTML', 'en-US': 'Read clipboard HTML' },
    scope: 'all',
    level: 'warn',
    handler: ([type]) => clipboard.readHTML(type as CbType),
  },
  {
    key: 'clipboard.readRTF',
    description: { 'zh-CN': '读取剪贴板 RTF', 'en-US': 'Read clipboard RTF' },
    scope: 'all',
    level: 'warn',
    handler: ([type]) => clipboard.readRTF(type as CbType),
  },
  {
    key: 'clipboard.readBookmark',
    description: { 'zh-CN': '读取剪贴板书签', 'en-US': 'Read clipboard bookmark' },
    scope: 'all',
    level: 'warn',
    handler: () => clipboard.readBookmark(),
  },
  {
    key: 'clipboard.readFindText',
    description: { 'zh-CN': '读取查找文本', 'en-US': 'Read find text' },
    scope: 'all',
    level: 'warn',
    handler: () => clipboard.readFindText(),
  },
  {
    key: 'clipboard.readImage',
    description: { 'zh-CN': '读取剪贴板图片（返回 dataUrl + 尺寸）', 'en-US': 'Read clipboard image (dataUrl + size)' },
    scope: 'all',
    level: 'warn',
    handler: ([type]) => {
      const img = clipboard.readImage(type as CbType)
      return { dataUrl: img.isEmpty() ? '' : img.toDataURL(), size: img.getSize() }
    },
  },
  {
    key: 'clipboard.readBuffer',
    description: { 'zh-CN': '按 format 读剪贴板 Buffer', 'en-US': 'Read clipboard buffer by format' },
    scope: 'all',
    level: 'warn',
    handler: ([format]) => clipboard.readBuffer(String(format)),
  },
  {
    key: 'clipboard.read',
    description: { 'zh-CN': '按 format 读剪贴板（实验性）', 'en-US': 'Read clipboard by format (experimental)' },
    scope: 'all',
    level: 'warn',
    handler: ([format]) => clipboard.read(String(format)),
  },
  {
    key: 'clipboard.availableFormats',
    description: { 'zh-CN': '剪贴板可用 format 列表', 'en-US': 'List available clipboard formats' },
    scope: 'all',
    level: 'warn',
    handler: ([type]) => clipboard.availableFormats(type as CbType),
  },
  {
    key: 'clipboard.has',
    description: { 'zh-CN': '剪贴板是否含指定 format', 'en-US': 'Check clipboard has format' },
    scope: 'all',
    level: 'warn',
    handler: ([format, type]) => clipboard.has(String(format), type as CbType),
  },
]

const WRITE: ApiDefinition[] = [
  {
    key: 'clipboard.writeText',
    description: { 'zh-CN': '写入剪贴板纯文本', 'en-US': 'Write clipboard text' },
    scope: 'all',
    level: 'warn',
    handler: ([text]) => clipboard.writeText(String(text)),
  },
  {
    key: 'clipboard.writeHTML',
    description: { 'zh-CN': '写入剪贴板 HTML', 'en-US': 'Write clipboard HTML' },
    scope: 'all',
    level: 'warn',
    handler: ([markup, type]) => clipboard.writeHTML(String(markup), type as CbType),
  },
  {
    key: 'clipboard.writeRTF',
    description: { 'zh-CN': '写入剪贴板 RTF', 'en-US': 'Write clipboard RTF' },
    scope: 'all',
    level: 'warn',
    handler: ([text, type]) => clipboard.writeRTF(String(text), type as CbType),
  },
  {
    key: 'clipboard.writeBookmark',
    description: { 'zh-CN': '写入剪贴板书签', 'en-US': 'Write clipboard bookmark' },
    scope: 'all',
    level: 'warn',
    handler: ([title, url, type]) => clipboard.writeBookmark(String(title), String(url), type as CbType),
  },
  {
    key: 'clipboard.writeFindText',
    description: { 'zh-CN': '写入查找文本', 'en-US': 'Write find text' },
    scope: 'all',
    level: 'warn',
    handler: ([text]) => clipboard.writeFindText(String(text)),
  },
  {
    key: 'clipboard.writeImage',
    description: { 'zh-CN': '写入剪贴板图片（dataUrl/path/buffer）', 'en-US': 'Write clipboard image (dataUrl/path/buffer)' },
    scope: 'all',
    level: 'warn',
    handler: ([img, type]) => {
      const o = (img ?? {}) as { dataUrl?: string; path?: string; buffer?: ArrayBuffer; width?: number; height?: number }
      let image = nativeImage.createEmpty()
      if (o.dataUrl) image = nativeImage.createFromDataURL(o.dataUrl)
      else if (o.path) image = nativeImage.createFromPath(o.path)
      else if (o.buffer) image = nativeImage.createFromBuffer(Buffer.from(o.buffer), { width: o.width, height: o.height })
      clipboard.writeImage(image, type as CbType)
    },
  },
  {
    key: 'clipboard.writeBuffer',
    description: { 'zh-CN': '按 format 写剪贴板 Buffer', 'en-US': 'Write clipboard buffer by format' },
    scope: 'all',
    level: 'warn',
    handler: ([format, buffer, type]) => clipboard.writeBuffer(String(format), Buffer.from(buffer as ArrayBuffer), type as CbType),
  },
  {
    key: 'clipboard.write',
    description: { 'zh-CN': '组合写入剪贴板（text/html/image/rtf/bookmark）', 'en-US': 'Write composite clipboard data' },
    scope: 'all',
    level: 'warn',
    handler: ([data, type]) => {
      const o = (data ?? {}) as {
        text?: string
        html?: string
        image?: { dataUrl?: string; path?: string }
        rtf?: string
        bookmark?: { title: string; url: string }
      }
      let image: Electron.NativeImage | undefined
      if (o.image?.dataUrl) image = nativeImage.createFromDataURL(o.image.dataUrl)
      else if (o.image?.path) image = nativeImage.createFromPath(o.image.path)
      clipboard.write({ text: o.text, html: o.html, image, rtf: o.rtf, bookmark: o.bookmark?.url }, type as CbType)
    },
  },
  {
    key: 'clipboard.clear',
    description: { 'zh-CN': '清空剪贴板', 'en-US': 'Clear clipboard' },
    scope: 'all',
    level: 'warn',
    handler: ([type]) => clipboard.clear(type as CbType),
  },
]

export const clipboardApis: ApiDefinition[] = [...READ, ...WRITE]
