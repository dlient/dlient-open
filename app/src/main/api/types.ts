/**
 * api/types.ts - host-api 元数据模型（方案 v2）。
 * 每个 api 五字段：key / description / scope / level / handler。
 * 详见 docs/specs/host-api-v2.md。
 */
import type { HostApiCallContext } from '../export'

/** scope：调用通道门禁 + system 专属 */
export type ApiScope = 'all' | 'worker' | 'ui' | 'system'
/** level：安装风险标签 */
export type ApiLevel = 'default' | 'warn' | 'dangerous'

export interface ApiDescription {
  'zh-CN': string
  'en-US': string
}

export interface ApiDefinition {
  /** 方法唯一标识（manifest.permissions 声明值） */
  key: string
  description: ApiDescription
  scope: ApiScope
  level: ApiLevel
  /** 实现（必填）：简单 API 内联；复杂 API 引 lib/ 方法 */
  handler: (args: unknown[], ctx: HostApiCallContext) => unknown | Promise<unknown>
}
