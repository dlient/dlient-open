/**
 * runtime-confirm 委托（独立确认视图实现 + 同源聚合）。
 *
 * 宿主主进程不再把确认请求发到共享渲染层（那会被同上下文的恶意插件劫持）：
 * 这里只做「RuntimeConfirmRequest → 权限弹框数据」的翻译，交给 dialog.ts 的独立 WebContentsView
 * 确认视图渲染（app/dialog/index.html + dialog/preload.ts），决策结果经 DIALOG_REPLY 回传并校验。
 *
 * 同源聚合（方案C）：同一来源插件（fromPluginId）在短窗口（100ms）内发起的多次确认请求
 * 合并为**一条**弹框（items 展平），webview 只渲染一次；用户决策结果分发给组内全部调用方。
 *  - 避免插件循环/并发请求 → 弹框堆积；
 *  - 不同来源插件的确认互不合并（各自弹框，仍可叠加）。
 *
 * 承载四类确认（docs/specs/plugin-permission.md §6）：
 *  - runtime-confirm：插件 A 调用插件 B 的方法；
 *  - fs-access / net-access / spawn-confirm：资源级运行时授权（带 description + 作用域三选）；
 *  - batch：批量预授权（auth.requestGrants 逐项确认，此处按整体确认）。
 */

import type { DialogManager, PermissionDialogData, DialogResult } from './dialog'
import type { RuntimeConfirmRequest, RuntimeConfirmResult } from './runtime'
import { mt } from './i18n'

/** 同源确认聚合窗口（方案C：窗口内同源请求合并为一条弹框） */
const MERGE_WINDOW_MS = 100

/** 按确认类型选图标（与 app/dialog/index.html 的 ICON_SRC 对应：fs/net/cmd/log/plugin） */
function iconForType(type: string, method: string): string {
  if (type === 'fs-access') return 'fs'
  if (type === 'net-access') return 'net'
  if (type === 'spawn-confirm') return 'cmd'
  if (/log/i.test(method)) return 'log'
  return 'plugin'
}

/** 单条确认请求 → 弹框数据 */
function toData(req: RuntimeConfirmRequest): PermissionDialogData {
  // 资源类（fs/net/spawn/batch）：items.method 已由调用方拼好类别前缀（如「文件操作：读取 / 写入」），直接展示；
  // 能力类（runtime-confirm）：跨插件调用：目标插件 · 方法
  const isResource = req.type === 'fs-access' || req.type === 'net-access' || req.type === 'spawn-confirm' || req.type === 'batch'
  return {
    fromName: req.items[0]?.fromName ?? '',
    canScope: req.canScope === true,
    batch: req.batch === true,
    items: req.items.map((it) => {
      // dev 日志访问（authorizeLogAccess 的方法常量 'logs'）：本质是「日志授权」而非跨插件方法调用，
      // 单独以「日志访问」标签展示 + log 图标（不套跨插件调用的 target 插件图标）。
      const isLogAccess = !isResource && it.method === 'logs'
      return {
        kind: isResource
          ? it.method
          : isLogAccess
            ? `${mt('resource.category.log')}：${it.targetName}`
            : `${mt('resource.category.call')}：${it.targetName} · ${it.method}`,
        reason: it.desc,
        scope: it.resource ? [it.resource] : [],
        method: it.method,
        icon: isLogAccess ? 'log' : iconForType(req.type, it.method),
        iconSrc: isLogAccess ? undefined : it.iconSrc,
      }
    }),
  }
}

/** 聚合窗口内多条同源请求 → 单条弹框数据（items 展平；scope/批次数以任一为宽） */
function mergeData(entries: Array<{ req: RuntimeConfirmRequest }>): PermissionDialogData {
  const first = toData(entries[0].req)
  return {
    fromName: first.fromName,
    canScope: entries.some((e) => e.req.canScope === true),
    batch: entries.some((e) => e.req.batch === true),
    items: entries.flatMap((e) => toData(e.req).items),
  }
}

/** 弹框决策 → 授权结果（分发同源组内全部调用方） */
function toResult(res: DialogResult): RuntimeConfirmResult {
  if (!res.ok) return { allow: false, scope: 'persistent' }
  if (res.action === 'once') return { allow: true, scope: 'session' }
  if (res.action === 'permanent' || res.action === 'confirm') return { allow: true, scope: 'persistent' }
  return { allow: false, scope: 'persistent' }
}

/** 同源待决确认（弹框显示期间挂起；决策后 resolve） */
interface PendingConfirm {
  req: RuntimeConfirmRequest
  resolve: (r: RuntimeConfirmResult) => void
}

/** 同源聚合缓冲 */
interface MergeBuffer {
  timer: ReturnType<typeof setTimeout>
  entries: PendingConfirm[]
}

/** 创建「宿主 → 独立确认视图」委托：返回 requestRuntimeConfirm(req) 实现 */
export function createRuntimeConfirmDelegate(
  dialogManager: DialogManager,
): (req: RuntimeConfirmRequest) => Promise<RuntimeConfirmResult> {
  /** 同源聚合缓冲：group（fromPluginId）→ 窗口定时器 + 待合并请求 */
  const buffers = new Map<string, MergeBuffer>()

  function flush(group: string): void {
    const buf = buffers.get(group)
    if (!buf) return
    buffers.delete(group)
    clearTimeout(buf.timer)
    // 窗口结束：合成一条弹框，决策结果分发给组内全部调用方
    void dialogManager
      .showPermissionDialog(mergeData(buf.entries))
      .then((res) => {
        const result = toResult(res)
        for (const e of buf.entries) e.resolve(result)
      })
      .catch(() => {
        // 弹框不可用（窗口缺失等）：全部按拒绝处理，避免调用方永久 pending
        for (const e of buf.entries) e.resolve({ allow: false, scope: 'persistent' })
      })
  }

  return async (req) => {
    const group = req.fromPluginId ?? ''
    // 无来源标识（缺省/兜底装配）：不聚合，保持单条弹框
    if (!group) return dialogManager.showPermissionDialog(toData(req)).then(toResult)

    const existing = buffers.get(group)
    if (existing) {
      // 窗口内同源：并入待决列表，等待统一弹框
      return new Promise<RuntimeConfirmResult>((resolve) => {
        existing.entries.push({ req, resolve })
      })
    }
    // 新组：启动聚合窗口（固定 100ms，从首条到达起算）
    return new Promise<RuntimeConfirmResult>((resolve) => {
      const entries: PendingConfirm[] = [{ req, resolve }]
      const timer = setTimeout(() => flush(group), MERGE_WINDOW_MS)
      buffers.set(group, { timer, entries })
    })
  }
}
