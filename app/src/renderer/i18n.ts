/**
 * 宿主渲染层 i18n 资源（app/src/renderer/i18n.ts）。
 * 命名空间 'host'：宿主壳自身文案（启动页、授权确认桥等）。
 * 入口 main.tsx import 本文件注册；语言随 @dlient-open/i18n 全局 store（主进程 LANGUAGE 广播）。
 */
import { addResourceBundle } from '@dlient-open/i18n'

addResourceBundle('host', {
  'zh-CN': {
    // 启动页
    'startup.checking': '正在检查核心插件...',
    'startup.downloading': '正在下载核心插件...',
    'startup.installing': '正在安装核心插件...',
    'startup.starting': '正在启动核心插件...',
    'startup.ready': '正在加载核心插件...',
    'startup.network-error': '无法连接到服务器，核心插件缺失',
    'startup.retry': '重试',
    // 授权确认桥（runtime-confirm）
    'confirm.title.runtime-confirm': '插件权限请求',
    'confirm.title.fs-access': '文件访问授权',
    'confirm.title.net-access': '网络访问授权',
    'confirm.title.spawn-confirm': '命令运行授权',
    'confirm.title.batch': '批量权限授权',
    'confirm.title.fallback': '权限请求',
    'confirm.resource.head': '插件「{name}」申请以下访问权限：',
    'confirm.method.resource': '：{value}',
    'confirm.method.desc': '（{desc}）',
    'confirm.resource.foot': '授权后可在插件市场该插件的「权限」页撤销；「仅本次」在宿主重启后失效。',
    'confirm.capabilities.head': '插件「{name}」请求调用以下插件能力：',
    'confirm.capability.head': '插件「{name}」请求调用插件「{target}」的能力：',
    'confirm.capabilities.foot': '授权后 1 天内不再提示。',
    'confirm.scope.deny': '拒绝',
    'confirm.scope.session': '仅本次',
    'confirm.scope.persistent': '始终允许',
    'confirm.allow': '允许',
  },
  'en-US': {
    'startup.checking': 'Checking core plugins...',
    'startup.downloading': 'Downloading core plugins...',
    'startup.installing': 'Installing core plugins...',
    'startup.starting': 'Starting core plugins...',
    'startup.ready': 'Loading core plugins...',
    'startup.network-error': 'Cannot reach the server — core plugins are missing',
    'startup.retry': 'Retry',
    'confirm.title.runtime-confirm': 'Plugin permission request',
    'confirm.title.fs-access': 'File access authorization',
    'confirm.title.net-access': 'Network access authorization',
    'confirm.title.spawn-confirm': 'Command authorization',
    'confirm.title.batch': 'Batch permission request',
    'confirm.title.fallback': 'Permission request',
    'confirm.resource.head': 'Plugin "{name}" requests the following access:',
    'confirm.method.resource': ': {value}',
    'confirm.method.desc': ' ({desc})',
    'confirm.resource.foot': 'You can revoke this in the plugin market "Permissions" page; "This session only" expires after the host restarts.',
    'confirm.capabilities.head': 'Plugin "{name}" requests the following plugin capabilities:',
    'confirm.capability.head': 'Plugin "{name}" wants to call capabilities of plugin "{target}":',
    'confirm.capabilities.foot': 'Authorization lasts for 1 day.',
    'confirm.scope.deny': 'Deny',
    'confirm.scope.session': 'This session only',
    'confirm.scope.persistent': 'Always allow',
    'confirm.allow': 'Allow',
  },
})
