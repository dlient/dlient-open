import { addResourceBundle } from '@dlient-open/i18n'

// @dlient-open/ui 内置组件的文案，随语言切换
addResourceBundle('ui', {
  'zh-CN': {
    errorBoundaryTitle: (name: string) => `插件「${name}」发生错误`,
    errorBoundaryRetry: '重试',
    pluginLoading: '插件加载中...',
    pluginFailed: (name: string, message: string) => `加载插件「${name}」失败：${message}`,
    modalConfirm: '确认',
    modalCancel: '取消',
    modalClose: '关闭',
    // LogViewer
    logViewerAll: '全部',
    logViewerSearch: '搜索日志',
    logViewerClearSearch: '清空搜索',
    logViewerDownload: '下载日志',
    logViewerClear: '清空日志',
    logViewerReadFailed: '日志读取失败',
    logViewerEmpty: '没有匹配的日志',
    logViewerRequestDesc: (from: string, target: string) => `${from} 插件申请获取 ${target} 插件的日志信息`,
    logViewerRequestApprove: '同意申请',
    logViewerRequestDenied: '已拒绝该申请',
  },
  'en-US': {
    errorBoundaryTitle: (name: string) => `Plugin "${name}" encountered an error`,
    errorBoundaryRetry: 'Retry',
    pluginLoading: 'Loading plugin...',
    pluginFailed: (name: string, message: string) => `Failed to load plugin "${name}": ${message}`,
    modalConfirm: 'Confirm',
    modalCancel: 'Cancel',
    modalClose: 'Close',
    logViewerAll: 'All',
    logViewerSearch: 'Search logs',
    logViewerClearSearch: 'Clear search',
    logViewerDownload: 'Download logs',
    logViewerClear: 'Clear logs',
    logViewerReadFailed: 'Failed to read logs',
    logViewerEmpty: 'No matching logs',
    logViewerRequestDesc: (from: string, target: string) => `Plugin "${from}" requests access to logs of plugin "${target}"`,
    logViewerRequestApprove: 'Approve',
    logViewerRequestDenied: 'The request was denied',
  },
})
