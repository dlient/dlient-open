import { addResourceBundle } from '@dlient-open/i18n'

// __PLUGIN_ID__ 文案（命名空间用插件 id 保证唯一）
addResourceBundle('__PLUGIN_ID__', {
  'zh-CN': {
    title: '示例插件',
    hint: '纯 UI 插件（无 worker）：宿主能力经 api.* 直连调用。',
    click: '写一条日志',
    clicked: '已写入 {{count}} 条日志',
    logsShow: '查看日志',
    logsHide: '收起日志',
  },
  'en-US': {
    title: 'Demo Plugin',
    hint: 'UI-only plugin (no worker): call host capabilities through api.* directly.',
    click: 'Write a log line',
    clicked: 'Wrote {{count}} log line(s)',
    logsShow: 'Show logs',
    logsHide: 'Hide logs',
  },
})
