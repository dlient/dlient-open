/**
 * __PLUGIN_ID__ worker 入口（src/main/index.ts）。
 * 模板插件最小 worker：注册一个示例方法（命名规范：插件名.方法名）。
 * 插件自有日志（示例）：rpc.log.write 写入插件日志（声明 manifest.permissions 的 log 即可，无需 fs 权限），
 * 落 plugin-data/__PLUGIN_ID__/logs/main.log（JSONL，宿主侧轮转/订阅推送）。
 */

import { createWorkerRpc, PluginError } from '@dlient-open/plugin-sdk'

const rpc = createWorkerRpc('__PLUGIN_ID__')

/**
 * 业务错误码：插件自管，须 <= PLUGIN_ERROR_START(-3001)（宿主保留 -1xxx / -2xxx，插件区间从 -3001 起向更小），
 * 宿主不解释其含义。通过 plugin-sdk 的 PluginError（code + msg）携带；msg 可为字符串或多语言对象。
 */
const PluginErrCode = {
  NOT_FOUND: -3001,
  PERMISSION_DENIED: -3002,
} as const

rpc.registerHandler('__PLUGIN_ID__.greet', () => {
  void rpc.log.write('info', 'greet called', { from: 'worker' })
  // 成功：直接 return 裸数据即可，SDK 会自动包成 { code: 0, data, from }（推荐写法）。
  // 需要显式构造信封时可用 rpc.success(data)（SDK 检测到已是信封会原样透传）。
  return `Hello from __PLUGIN_ID__ worker`
})

rpc.registerHandler('__PLUGIN_ID__.echo', () => {
  void rpc.log.write('info', 'echo called', { from: 'worker' })
  // 正常返回一个「失败信封」（不抛错）：rpc.error(code, msg) —— 业务码 + 多语言 msg，渲染层按 locale 解析。
  // 与 guard 的区别：调用方能拿到 code 继续处理，而非走 catch 分支。
  return rpc.error(PluginErrCode.NOT_FOUND, { enUS: 'Not found', zhCN: '未找到' })
})

rpc.registerHandler('__PLUGIN_ID__.guard', () => {
  void rpc.log.write('info', 'guard called', { from: 'worker' })
  // 抛错：插件侧 throw PluginError，SDK 兜底包装为失败信封（业务码须 <= -3001），不会向外 reject。
  throw new PluginError(PluginErrCode.PERMISSION_DENIED, { enUS: 'Permission denied', zhCN: '无权限' })
})
