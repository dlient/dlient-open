// 原生模块重建（路径 A：vendor 预编译 + @electron/rebuild，见 docs/specs/build.md §2.2）。
// 用法：node build-native.mjs
//
// 说明：
//   - 本脚本用 @electron/rebuild 把 nativeModules.dependencies 声明的原生模块针对宿主
//     Electron ABI 重编译（当前 Electron 版本经 process.versions.electron 探测）；
//   - 输出到 node_modules 内（rebuild 默认 in-place），构建/发布时原生产物随 dist 一并打包；
//   - 逐平台构建：发布前须在每个目标平台分别执行（产物与平台强绑定）。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let manifest = {}
try {
  manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
} catch {
  /* 忽略 */
}
const nativeModules = manifest?.dlient?.nativeModules?.dependencies ?? {}
const deps = Object.keys(nativeModules)

if (deps.length === 0) {
  console.log('[native] 未声明 dlient.nativeModules.dependencies，跳过重建')
  process.exit(0)
}
if (!existsSync(join(root, 'node_modules'))) {
  console.error('[native] node_modules 不存在，请先 npm install')
  process.exit(1)
}

// 明确传给 rebuild 的原生模块名（避免扫描整棵 node_modules）
const modules = deps.join(' ')
const electronVersion = process.versions.electron
console.log(`[native] @electron/rebuild: ${modules} (Electron ${electronVersion ?? '(非 Electron 环境，跳过)'})`)
if (!electronVersion) process.exit(0)

const cmd = `npx electron-rebuild -m ${root} -v ${electronVersion} -f -w ${modules}`
execSync(cmd, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' })
console.log('[native] 原生模块重建完成（产物在 node_modules，发布时随 dist 打包）')
