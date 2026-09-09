#!/usr/bin/env node
/**
 * publish.mjs - @dlient-open/create-plugin 打包 / 发布脚本。
 *
 * 模板单源：包内 templates/plugin-demo 即源（无外部同步），发布前校验存在即可。
 *
 * 用法：
 *   node publish.mjs prepare   # 校验模板已就位（本地跑 CLI 前需要）
 *   node publish.mjs pack      # npm pack（产出 tarball，可先本地验证）
 *   node publish.mjs publish   # npm publish（registry）
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(__dirname, 'templates', 'plugin-demo')

const action = process.argv[2] ?? 'prepare'

function prepare() {
  if (!existsSync(TEMPLATE_DIR)) {
    console.error(`模板不存在: ${TEMPLATE_DIR}`)
    process.exit(1)
  }
  console.log('[create-plugin] 模板已就位 ->', TEMPLATE_DIR)
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
