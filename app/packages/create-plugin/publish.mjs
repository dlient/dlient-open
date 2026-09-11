#!/usr/bin/env node
/**
 * publish.mjs - @dlient-open/create-plugin 打包 / 发布脚本。
 *
 * 模板：`templates/{default,worker,native-host,native}` 四份，各自按模式预裁剪（无运行时裁剪逻辑）。
 * 文档单一来源：`.agent/` 由本脚本从仓库 `skills/dlient-plugin-dev`（英文）同步生成到
 * `templates/_shared/.agent`（四份模板共用），CLI 生成工程时统一拷入 —— 模板文档与 skills 永不漂移。
 *
 * 用法：
 *   node publish.mjs prepare   # 同步 .agent + 校验 4 份模板（本地跑 CLI 前需要）
 *   node publish.mjs pack      # npm pack（产出 tarball，可先本地验证）
 *   node publish.mjs publish   # npm publish（registry）
 */

import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_ROOT = join(__dirname, 'templates')
/** 模式 → 模板目录（与 bin/cli.mjs 的 MODE_BY_FLAG 一一对应） */
const TEMPLATE_MODES = ['default', 'worker', 'native-host', 'native']
/** 文档来源：仓库 skills 英文技能（create-plugin → app/packages → app → dlient-open/skills/dlient-plugin-dev） */
const SKILLS_SOURCE = join(__dirname, '..', '..', '..', 'skills', 'dlient-plugin-dev')
const SHARED_AGENT_DIR = join(TEMPLATES_ROOT, '_shared', '.agent')

const action = process.argv[2] ?? 'prepare'

/** 同步共享 .agent：仓库 skills 存在即以它为准（rm + cp，已下线文档一并移除）；否则要求包内已有产物 */
function syncAgent() {
  if (existsSync(join(SKILLS_SOURCE, 'SKILL.md'))) {
    rmSync(SHARED_AGENT_DIR, { recursive: true, force: true })
    cpSync(SKILLS_SOURCE, SHARED_AGENT_DIR, { recursive: true })
    console.log('[create-plugin] .agent 已从 skills 同步 ->', SHARED_AGENT_DIR)
    return
  }
  if (existsSync(join(SHARED_AGENT_DIR, 'SKILL.md'))) {
    console.log('[create-plugin] 未找到仓库 skills，沿用现有 .agent ->', SHARED_AGENT_DIR)
    return
  }
  console.error(`未找到 .agent 来源：既无 ${SKILLS_SOURCE}，也无 ${SHARED_AGENT_DIR}`)
  process.exit(1)
}

function prepare() {
  syncAgent()
  const missing = TEMPLATE_MODES.filter((m) => !existsSync(join(TEMPLATES_ROOT, m)))
  if (missing.length > 0) {
    console.error(`模板缺失: ${missing.join(', ')}（应在 ${TEMPLATES_ROOT}）`)
    process.exit(1)
  }
  console.log('[create-plugin] 模板已就位 ->', TEMPLATE_MODES.map((m) => `templates/${m}`).join(', '))
}

switch (action) {
  case 'prepare':
    prepare()
    break
  case 'pack':
    prepare()
    execSync('npm pack', { stdio: 'inherit', cwd: __dirname })
    break
  case 'publish':
    prepare()
    execSync('npm publish', { stdio: 'inherit', cwd: __dirname })
    break
  default:
    console.error('用法: node publish.mjs <prepare|pack|publish>')
    process.exit(1)
}
