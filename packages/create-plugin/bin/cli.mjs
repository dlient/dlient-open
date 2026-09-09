#!/usr/bin/env node
/**
 * create-plugin - @dlient-open 插件开发脚手架（dlient-open 开源版，模板单源 plugin-demo）。
 *
 * 用法：
 *   npx @dlient-open/create-plugin my-plugin                # 当前目录创建 my-plugin/
 *   npx @dlient-open/create-plugin my-plugin --name "我的插件"  # 指定显示名
 *   npx @dlient-open/create-plugin my-plugin --dir ~/dev       # 指定创建目录
 *   npx @dlient-open/create-plugin my-plugin --native-host     # 原生模块（native-host 模式，官方 Node 子进程）
 *   npx @dlient-open/create-plugin my-plugin --native          # 原生模块（vendor + @electron/rebuild，逐平台构建）
 *
 * 默认不执行 npm install、不创建 git 仓库（生成后可进入插件目录自行安装/初始化）。
 *
 * 按参数生成不同的 manifest / 模板代码：
 *   - --native-host：dlient.nativeModules（用户侧 npm 安装原生模块，免 rebuild）+ src/native-host/
 *     + @dlient-open/native-host-sdk（build-worker.mjs 自动产出 dist/native-host.js）；
 *   - --native（无 --native-host）：dlient.native=true + @electron/rebuild + script/build-native.mjs
 *     （路径 A：vendor 预编译，逐平台构建）；
 * 发布产物统一普通打包（dist 多文件）：npm run pack 直接产出免签名 .dlient（开源宿主导入端不验签）。
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(__dirname, '..', 'templates', 'plugin-demo')
/** 占位符替换时跳过的目录（依赖/产物/版本控制） */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

// ---- 参数解析 ----
const args = process.argv.slice(2)
const opts = { dir: process.cwd(), native: false, nativeHost: false, name: '' }
let id = ''
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--dir') opts.dir = args[++i]
  else if (a === '--name') opts.name = String(args[++i] ?? '')
  else if (a === '--native-host') { opts.nativeHost = true; opts.native = true }
  else if (a === '--native') opts.native = true
  // 兼容参数（闭源版 dev-tools 创建流程会附带；开源版无 dev-tools，空操作保留以兼容）
  else if (a === '--skip-install' || a === '--no-git') { /* no-op */ }
  else if (a.startsWith('-')) { console.error(`未知参数: ${a}`); process.exit(1) }
  else if (!id) id = a
  else { console.error(`多余参数: ${a}`); process.exit(1) }
}

// ---- 校验 ----
if (!id) {
  console.error('用法: create-plugin <插件id> [--name 显示名] [--dir 目录] [--native-host|--native]')
  process.exit(1)
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`插件 ID 不合法（须以小写字母开头，仅含小写字母/数字/连字符）: ${id}`)
  process.exit(1)
}
const name = opts.name || id
if (!existsSync(TEMPLATE_DIR)) {
  console.error(`未找到模板: ${TEMPLATE_DIR}\n请先运行: npm run prepare:templates`)
  process.exit(1)
}

const baseDir = resolve(opts.dir)
const target = join(baseDir, id)
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`目标目录已存在且非空: ${target}`)
  process.exit(1)
}

// ---- 拷贝模板 + 按参数裁剪 + 占位符替换 ----
mkdirSync(baseDir, { recursive: true })
// 只拷贝源码模板：跳过 node_modules/dist/.git（模板源目录可能残留构建产物，脚手架不应带入）
cpSync(TEMPLATE_DIR, target, { recursive: true, filter: isTemplateSource })
// 未选用的能力文件删除（模板内含全部能力骨架，按参数裁剪）
if (!opts.nativeHost) rmSync(join(target, 'src', 'native-host'), { recursive: true, force: true })
if (!(opts.native && !opts.nativeHost)) rmSync(join(target, 'script', 'build-native.mjs'), { force: true })
// asar 已彻底禁用：生成的插件一律统一普通打包（dist 多文件），模板残留的 build-asar.mjs 直接剔除
rmSync(join(target, 'script', 'build-asar.mjs'), { force: true })

replacePlaceholders(target, { __PLUGIN_ID__: id, __PLUGIN_NAME__: name })
// assets 装配（与 skill 文档 create-plugin.md「模板目录结构」一致）：
//   - 只保留按插件 id 生成的 icon.svg（不散装 A-Z 字母图标）；
//   - 插件说明写入 assets/index.md（默认/英文）+ index.zh-CN.md + index.en-US.md；
//   - mcp.json 收进 assets/；SKILL.md 保留在 skills/ 下。
assembleAssets(target, id)
applyManifestOptions(target, opts, id)

console.log(`\n✔ 已创建插件: ${target}（显示名: ${name}${opts.native ? `，原生模块: ${opts.nativeHost ? 'native-host 模式' : 'vendor + rebuild 模式'}` : ''}）\n`)

console.log(`\n下一步：
  1. cd ${target}
  2. npm install           # 脚手架默认不自动安装依赖（@dlient-open/* 包发布前，可用本地 file: 链接）
  3. npm run build         # 构建 UI（remoteEntry.js）+ worker（统一普通打包，dist 多文件）${opts.native && !opts.nativeHost ? ' + 原生模块重建' : ''}
  4. npm run pack          # 生成免签名 .dlient（无市场/签名链路）
  5. 打开 dlient-open 开源版 → 左下角「导入插件」选择该 .dlient\n`)

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
function assembleAssets(root, id) {
  const tplAssets = join(TEMPLATE_DIR, 'assets')
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

/** 遍历替换文本文件中的占位符（map：占位符 → 替换值；二进制/含 NUL 跳过） */
function replacePlaceholders(root, replacements) {
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
        for (const [ph, value] of Object.entries(replacements)) {
          if (content.includes(ph)) {
            content = content.split(ph).join(value)
            changed = true
          }
        }
        if (changed) writeFileSync(full, content, 'utf-8')
      }
    }
  }
  walk(root)
}

/** 按参数改写生成插件的 package.json manifest（图标 / 原生模块） */
function applyManifestOptions(root, opts, id) {
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const dlient = pkg.dlient
  const scripts = pkg.scripts
  const devDeps = pkg.devDependencies

  // 图标：固定 assets/icon.svg（assembleAssets 已按插件 id 首字母生成该图标）
  dlient.icon = 'assets/icon.svg'

  if (opts.nativeHost) {
    // 路径 B：native-host 模式（官方 Node 子进程承载原生模块，免 @electron/rebuild）
    dlient.nativeModules = { useBundledNode: true, dependencies: {} }
    dlient.native = false
    devDeps['@dlient-open/native-host-sdk'] = '^0.3.0'
    devDeps['@types/node'] = '^20.0.0'
  } else if (opts.native) {
    // 路径 A：vendor 预编译 + @electron/rebuild（逐平台构建）
    dlient.native = true
    devDeps['@electron/rebuild'] = '^3.6.0'
    scripts['build:native'] = 'node script/build-native.mjs'
  }

  // build 尾链：clean && build:ui && build:worker [+ build:native]
  const chain = ['node script/build-clean.mjs', 'npm run build:ui', 'npm run build:worker']
  if (scripts['build:native']) chain.push('npm run build:native')
  scripts.build = chain.join(' && ')

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}
