/**
 * api/i18n.ts - i18n 模块 host-api。
 */
import type { ApiDefinition } from './types'
import { getMainLocale } from '../i18n'

export const i18nApis: ApiDefinition[] = [
  {
    key: 'i18n.getLocale',
    description: { 'zh-CN': '宿主当前语言（zh-CN / en-US）', 'en-US': 'Host current language (zh-CN / en-US)' },
    scope: 'all',
    level: 'default',
    handler: () => getMainLocale(),
  },
]
