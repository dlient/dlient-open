/**
 * __PLUGIN_ID__ worker 入口（src/main/index.ts）—— 可直接复制的 worker 示例。
 *
 * UI + worker 插件的最小 worker：注册一个示例方法（命名约定：<plugin-id>.<method>）
 * 以及特殊的 `grant` handler。worker 是沙箱化的纯 Node 进程
 * （无 DOM）。日志经 rpc.log.write 写入
 * plugin-data/__PLUGIN_ID__/logs/main.log（JSONL）—— 在 manifest.permissions
 * 声明 `log` 即可（无需 fs 权限）。
 *
 * 把本文件复制到 src/main/index.ts，然后按 references/mode-switch-worker.md
 * 完成 manifest / scripts / package.json 的改动。
 */

import { createWorkerRpc } from '@dlient-open/plugin-sdk'

const rpc = createWorkerRpc('__PLUGIN_ID__')

// ---- 示例方法 ----
// 注册 handler 只是让宿主 + 本插件可以调用它。
// 若要**其它插件**也能调用，还需在 `dlient.expose` 中加入对应条目
// （见 references/worker.md 的「向其它插件暴露方法」）。仅当其它插件
// 确实必须调用本插件时才这样做。
rpc.registerHandler('__PLUGIN_ID__.greet', async ([name]: [string?]) => {
  void rpc.log.write('info', 'greet called', { from: 'worker' })
  // 直接返回普通数据即可：SDK 会包装成 { code: 0, data, from }。
  return `Hello ${name ?? 'world'} from __PLUGIN_ID__ worker`
})

// ---- 特殊的 `grant` handler ----
// 当其它插件需要授权（或调用 rpc.plugin.requestGrant）时，
// 宿主会调用字面量 `grant` handler。仅当 `expose` 声明了
// 对应的 `"grant"` 条目时才生效（见 references/worker.md §4.3）。
rpc.registerHandler('grant', async () => ({
  // 'allow' | 'ask' | 'deny'。优先 'ask'（让用户在调用时决定）；
  // 对涉及用户隐私、密码、密钥或 token 的一律返回 'deny'。
  status: 'ask' as const,
}))
