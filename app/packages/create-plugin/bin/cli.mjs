#!/usr/bin/env node
/**
 * create-plugin - @dlient-open 插件开发脚手架（dlient-open 开源版）。
 *
 * 用法：
 *   npx @dlient-open/create-plugin my-plugin                 # default 模式：纯 UI（无 worker、无 skills）
 *   npx @dlient-open/create-plugin my-plugin --worker        # worker 模式：UI + worker（RPC / 子进程）
 *   npx @dlient-open/create-plugin my-plugin --native-host   # native-host 模式：worker + 原生模块（官方 Node 子进程，免 rebuild）
 *   npx @dlient-open/create-plugin my-plugin --native        # native 模式：worker + vendor 预编译（@electron/rebuild，逐平台）
 *   npx @dlient-open/create-plugin my-plugin --name "我的插件"  # 指定显示名
 *   npx @dlient-open/create-plugin my-plugin --dir ~/dev       # 指定创建目录
 *
 * 模板：templates/{default,worker,native-host,native} 四份，模式参数互斥（缺省 default）。
 * 四份模板共用一份 `.agent/`（发布前由 publish.mjs 从 `skills/dlient-plugin-dev` 同步生成，
 * 生成工程时统一拷入），避免多份文档漂移。
 *
 * 默认不执行 npm install、不创建 git 仓库（生成后可进入插件目录自行安装/初始化）。
 * 发布产物统一普通打包（dist 多文件）：npm run pack 直接产出免签名 .dlient（开源宿主导入端不验签）。
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_ROOT = join(__dirname, '..', 'templates')
/** 四份模板共用的 .agent（发布前由 publish.mjs 从仓库 skills 英文文档同步） */
const SHARED_AGENT_DIR = join(TEMPLATES_ROOT, '_shared', '.agent')
/** 占位符替换时跳过的目录（依赖/产物/版本控制） */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

/** 模式参数 → 模板目录 */
const MODE_BY_FLAG = { '--worker': 'worker', '--native-host': 'native-host', '--native': 'native' }

/** 模式展示名 / 构建说明（创建成功后的提示文案） */
const MODE_LABEL = {
  default: '（纯 UI，无 worker）',
  worker: '（UI + worker）',
  'native-host': '（UI + worker + 原生模块，官方 Node 子进程）',
  native: '（UI + worker + vendor 预编译原生模块）',
}
const BUILD_HINT = {
  default: '构建 UI → dist/remoteEntry.js（+ CSS/assets）；纯 UI 模式无 worker 产物',
  worker: '构建 UI（remoteEntry.js）+ worker（dist/worker.js）',
  'native-host': '构建 UI + worker + native-host（dist/native-host.js）',
  native: '构建 UI + worker + 原生模块重建（build:native）',
}

// ---- 参数解析 ----
const args = process.argv.slice(2)
const opts = { dir: process.cwd(), name: '', mode: '' }
let id = ''
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--dir') opts.dir = args[++i]
  else if (a === '--name') opts.name = String(args[++i] ?? '')
  else if (MODE_BY_FLAG[a]) {
    const mode = MODE_BY_FLAG[a]
    if (opts.mode && opts.mode !== mode) {
      console.error(`模式参数互斥：已指定 --${opts.mode}，不能再给 ${a}（每个工程只能选一个模板）`)
      process.exit(1)
    }
    opts.mode = mode
  }
  // 兼容参数（闭源版 dev-tools 创建流程会附带；开源版无 dev-tools，空操作保留以兼容）
  else if (a === '--skip-install' || a === '--no-git') { /* no-op */ }
  else if (a.startsWith('-')) { console.error(`未知参数: ${a}`); process.exit(1) }
  else if (!id) id = a
  else { console.error(`多余参数: ${a}`); process.exit(1) }
}
if (!opts.mode) opts.mode = 'default'

// ---- 校验 ----
if (!id) {
  console.error('用法: create-plugin <插件id> [--name 显示名] [--dir 目录] [--worker|--native-host|--native]')
  process.exit(1)
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`插件 ID 不合法（须以小写字母开头，仅含小写字母/数字/连字符）: ${id}`)
  process.exit(1)
}
const name = opts.name || id
const TEMPLATE_DIR = join(TEMPLATES_ROOT, opts.mode)
if (!existsSync(TEMPLATE_DIR)) {
  console.error(`未找到模板 (${opts.mode}): ${TEMPLATE_DIR}\n请先运行: npm run prepare:templates`)
  process.exit(1)
}
if (!existsSync(SHARED_AGENT_DIR)) {
  console.error(`未找到共享文档: ${SHARED_AGENT_DIR}\n请先运行: npm run prepare:templates`)
  process.exit(1)
}

const baseDir = resolve(opts.dir)
const target = join(baseDir, id)
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`目标目录已存在且非空: ${target}`)
  process.exit(1)
}

// ---- 拷贝模板 + 共享 .agent + 占位符替换 ----
mkdirSync(baseDir, { recursive: true })
// 只拷贝源码模板：跳过 node_modules/dist/.git（模板源目录可能残留构建产物，脚手架不应带入）
cpSync(TEMPLATE_DIR, target, { recursive: true, filter: isTemplateSource })
// .gitignore 在模板内以 `gitignore` 命名存放（npm 发布时会剔除包内的 .gitignore 文件），生成时改回原名，
// 保证从 npm 安装的脚手架生成的工程同样自带忽略规则。
const tplGitignore = join(target, 'gitignore')
if (existsSync(tplGitignore)) {
  copyFileSync(tplGitignore, join(target, '.gitignore'))
  rmSync(tplGitignore, { force: true })
}
// .vscode/settings.json 同理无法随 npm 包发布（编辑器配置目录被忽略规则排除），
// 模板内以根级 `vscode-settings.json` 存放，生成时还原为 .vscode/settings.json。
const tplVscodeSettings = join(target, 'vscode-settings.json')
if (existsSync(tplVscodeSettings)) {
  mkdirSync(join(target, '.vscode'), { recursive: true })
  copyFileSync(tplVscodeSettings, join(target, '.vscode', 'settings.json'))
  rmSync(tplVscodeSettings, { force: true })
}
// 各模板已经按模式预裁剪（无 worker / 无 native 的文件不在模板内），此处无需再删文件。
// 共享 .agent：四份模板同一份内容（含 references/ 与 example/）
cpSync(SHARED_AGENT_DIR, join(target, '.agent'), { recursive: true })

replacePlaceholders(target, { __PLUGIN_ID__: id, __PLUGIN_NAME__: name })
// assets 装配（与 skill 文档 create-plugin.md「模板目录结构」一致）：
//   - 只保留按插件 id 生成的 icon.svg（不散装 A-Z 字母图标）；
//   - 插件说明写入 assets/index.md（默认/英文）+ index.zh-CN.md + index.en-US.md；
//   - mcp.json 收进 assets/；SKILL.md（worker 系模板）保留在 skills/ 下。
assembleAssets(target, id, TEMPLATE_DIR)

console.log(`\n✔ 已创建插件: ${target}（模式: ${opts.mode}${MODE_LABEL[opts.mode]}，显示名: ${name}）\n`)
console.log(`\n下一步：
  1. cd ${target}
  2. npm install           # 脚手架默认不自动安装依赖（@dlient-open/* 包发布前，可用本地 file: 链接）
  3. npm run build         # ${BUILD_HINT[opts.mode]}
  4. npm run pack          # 生成免签名 .dlient（无市场/签名链路）
  5. 打开 dlient-open 开源版 → 左下角「导入插件」选择该 .dlient
  6. 需要切换模式（加 worker / 原生模块）？见 .agent/references/mode-switch-*.md 与 AGENTS.md\n`)

// ---- helpers ----

/** cpSync filter：跳过 node_modules/dist/.git/package-lock.json（模板源目录可能残留构建产物与本地 lockfile）。
 *  只按条目 basename 判断 —— 不能用路径分段匹配：脚手架本身可能安装在含 dist 的路径下
 *  （如宿主 release 目录），路径分段匹配会把整棵模板误过滤。 */
function isTemplateSource(src) {
  const base = basename(src)
  return base !== 'node_modules' && base !== 'dist' && base !== '.git' && base !== 'package-lock.json'
}

/** 装配目标插件 assets/（与 skill 文档 create-plugin.md「模板目录结构」一致）：
 *  1. 图标：按插件 id 首字母从模板 assets/ 取对应字母 svg，重命名为 icon.svg（数字/符号开头回退 icon.svg）——
 *     生成工程只带这一个图标，不再散装 A-Z；
 *  2. 插件说明：assets/index.md（= README.md，默认/英文）、assets/index.zh-CN.md（= README.cn.md）、
 *     assets/index.en-US.md（= README.md）；
 *  3. assets/mcp.json：从插件根移入；
 *  （SKILL.md 不迁移，保留在 skills/SKILL.md 原位） */
function assembleAssets(root, id, templateDir) {
  const tplAssets = join(templateDir, 'assets')
  const assets = join(root, 'assets')
  rmSync(assets, { recursive: true, force: true })
  mkdirSync(assets, { recursive: true })

  // 1) 图标：按 id 首字母取模板 assets/<letter>.svg → assets/icon.svg
  const letter = /^[a-z]/i.test(id) ? id[0].toUpperCase() : ''
  const srcIcon =
    letter && existsSync(join(tplAssets, `${letter}.svg`)) ? join(tplAssets, `${letter}.svg`) : join(tplAssets, 'icon.svg')
  copyFileSync(srcIcon, join(assets, 'icon.svg'))

  // 2) 插件说明（占位符替换发生在 replacePlaceholders 之后，这里读到的已是替换后内容）
  const readmeDefault = readFileSync(join(root, 'README.md'), 'utf-8')
  writeFileSync(join(assets, 'index.md'), readmeDefault)
  writeFileSync(join(assets, 'index.en-US.md'), readmeDefault)
  const cnPath = join(root, 'README.cn.md')
  writeFileSync(join(assets, 'index.zh-CN.md'), existsSync(cnPath) ? readFileSync(cnPath, 'utf-8') : readmeDefault)

  // 3) mcp.json → assets/
  const mcpPath = join(root, 'mcp.json')
  if (existsSync(mcpPath)) {
    copyFileSync(mcpPath, join(assets, 'mcp.json'))
    rmSync(mcpPath, { force: true })
  }
}

/**
 * 遍历替换文本文件中的占位符（map：占位符 → 替换值；二进制/含 NUL 跳过）。
 * 容忍 Markdown 转义下划线：`__PLUGIN\_ID__` 与 `__PLUGIN_ID__` 都会被替换
 * （否则 README 里被转义的标题会原样保留占位符）。
 */
function replacePlaceholders(root, replacements) {
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = Object.entries(replacements).map(([ph, value]) => [
    // 每个下划线前允许一个字面反斜杠（Markdown 转义）：正则源码 \\?_ = 可选的反斜杠 + 下划线
    new RegExp(escapeRe(ph).replace(/_/g, '\\\\?_'), 'g'),
    value,
  ])
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        let content
        try {
          content = readFileSync(full, 'utf-8')
        } catch {
          continue
        }
        if (content.includes('\0')) continue
        let changed = false
        for (const [pattern, value] of patterns) {
          // 不用 pattern.test()：带 g 标志的正则会推进 lastIndex，跨文件判断会漏；
          // 直接 replace 并比较结果（String.replace 自身不受 lastIndex 影响）。
          const replaced = content.replace(pattern, value)
          if (replaced !== content) {
            content = replaced
            changed = true
          }
        }
        if (changed) writeFileSync(full, content, 'utf-8')
      }
    }
  }
  walk(root)
}
