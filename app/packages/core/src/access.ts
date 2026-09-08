/**
 * access 调用权限表达式解析（docs/v3/plugin-view.md §2.2/§2.3）。
 * 基元档位：private / default / system / public / install-confirm / runtime-confirm。
 * 组合语法：'|' = 或（满足任一或组），'&' = 且（或组内需全部满足）。
 * 例：`runtime-confirm | system` = system 插件直接调用；其它插件需 runtime-confirm。
 */

/** HOST 特殊调用方：宿主主进程侧（仅存在于主进程内部，渲染层视图身份不可伪造） */
export const HOST_PLUGIN_ID = 'host'

/** access 表达式求值上下文（由装配方注入：system 判定 + 授权表查询） */
export interface AccessEvalContext {
  /** 调用方是否为 system 插件 */
  isSystem: (pluginId: string) => boolean
  /** confirm 档授权是否有效（grantee = 调用方，target/method 为被调方法） */
  hasGrant: (grantee: string, target: string, method: string) => boolean
}

/** 判定单个条件档位 */
function matchesCondition(cond: string, from: string, target: string, method: string, ctx: AccessEvalContext): boolean {
  switch (cond) {
    case 'private':
      return from === target
    case 'default':
      return from === target || from === HOST_PLUGIN_ID
    case 'system':
      return ctx.isSystem(from)
    case 'public':
      return true
    case 'install-confirm':
    case 'runtime-confirm':
      // 授权记录自身携带有效期（install-confirm 永久 / runtime-confirm 1 天），此处仅查有效记录
      return ctx.hasGrant(from, target, method)
    default:
      return false
  }
}

/**
 * 求值 access 表达式。注意 confirm 条件命中时返回是否「已有授权」，
 * 未授权的情况由调用方（runtime.authorizeCall）走确认流程，而不是在此直接拒绝。
 */
export function evalAccessExpression(access: string, from: string, target: string, method: string, ctx: AccessEvalContext): boolean {
  const orGroups = access.split('|').map((s) => s.trim()).filter(Boolean)
  for (const group of orGroups) {
    const conds = group.split('&').map((s) => s.trim()).filter(Boolean)
    if (conds.length === 0) continue
    if (conds.every((c) => matchesCondition(c, from, target, method, ctx))) return true
  }
  return false
}

/** 默认 access（未声明时） */
export const DEFAULT_ACCESS = 'default'
