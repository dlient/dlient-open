import { addResourceBundle } from '@dlient-open/i18n'

// __PLUGIN_ID__ 文案（命名空间用插件 id 保证唯一）
addResourceBundle('__PLUGIN_ID__', {
  'zh-CN': {
    title: '示例插件',
    loading: '加载中…',
    greetFailed: '获取问候失败',
    logsShow: '查看日志',
    logsHide: '收起日志',
  },
  'en-US': {
    title: 'Demo Plugin',
    loading: 'Loading…',
    greetFailed: 'Failed to get greeting',
    logsShow: 'Show logs',
    logsHide: 'Hide logs',
  },
})
