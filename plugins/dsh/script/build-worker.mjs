// 构建 worker（esbuild）：打包 src/main/index.ts → <dist>/worker.js（utilityProcess 入口）
// 用法：node build-worker.mjs                    单次构建（输出到默认 dist）
//       node build-worker.mjs --outdir <dir>    指定输出目录（npm run pack 复用构建链，构建到 pack/<version>/dist）
//       node build-worker.mjs --watch           监听源码变化自动重建（dev 插件热重载用）
//
// 原生模块（native-host 模式，见 docs/todo/16-native-host.md）：
//   - 若 manifest 声明 dlient.nativeModules.dependencies，构建时将其 external 不打包，
//     运行时由官方 Node 子进程（<dist>/native-host.js）从插件目录 node_modules 解析；
//   - 若存在 src/native-host/index.ts，额外产出 <dist>/native-host.js（纯 Node 入口，platform:node）。
import { build, context } from 'esbuild'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const watchMode = process.argv.includes('--watch')
// --outdir：pack 场景把 worker 产物构建到 pack/<version>/dist（不改动开发期 dist）
const outdirIdx = process.argv.indexOf('--outdir')
const distDir = outdirIdx !== -1 && process.argv[outdirIdx + 1]
  ? path.resolve(__dirname, '..', process.argv[outdirIdx + 1])
  : path.join(__dirname, '..', 'dist')
const workerOut = path.join(distDir, 'worker.js')

// 原生模块（manifest dlient.nativeModules.dependencies）→ esbuild external（不打包 .node 二进制）
let manifest = {}
try {
  manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
} catch {
  /* package.json 缺失/损坏时按无原生模块处理 */
}
const nativePkgs = Object.keys(manifest?.dlient?.nativeModules?.dependencies ?? {})

const baseOptions = {
  bundle: true,
  platform: 'node',
  // 插件 package.json 声明 type: module，Electron utilityProcess 按 ESM 加载 worker，
  // 必须输出 ESM（CJS 的 require/module.exports 会因 module 未定义而崩溃）。
  format: 'esm',
  target: 'node20',
  external: ['electron', ...nativePkgs],
  // 方案 build.md 2.1：生产压缩；watch（dev）保持可读便于调试。
  minify: !watchMode,
  logLevel: 'info',
}

const workerOptions = {
  ...baseOptions,
  entryPoints: [path.join(__dirname, '..', 'src/main/index.ts')],
  outfile: workerOut,
}

// native-host 入口（存在时自动构建 <dist>/native-host.js）：纯 Node，原生模块 external，
// 运行时经 createRequire 从插件目录 node_modules 解析（ABI 匹配官方 Node，免 @electron/rebuild）。
const nativeHostEntry = path.join(__dirname, '..', 'src/native-host/index.ts')
const hasNativeHost = existsSync(nativeHostEntry)
const nativeHostOptions = {
  ...baseOptions,
  entryPoints: [nativeHostEntry],
  outfile: path.join(distDir, 'native-host.js'),
}

// 方案 build.md 2.1：生产构建后对 worker.js 做混淆（可选加固）。
// 未安装 javascript-obfuscator 时跳过（不阻塞构建）；混淆仅作用于 esbuild 产物，
// import/export 说明符与 RPC 方法名（运行时字符串）不受影响。混淆后做语法校验，
// 校验失败则回退为未混淆的压缩产物（避免产出损坏的 worker）。
async function obfuscateWorker(file) {
  try {
    const { default: obfuscator } = await import('javascript-obfuscator')
    const { readFileSync, writeFileSync } = await import('node:fs')
    const code = readFileSync(file, 'utf-8')
    // ESM 产物含 import/export 时跳过混淆：混淆器可能破坏模块说明符 / 导出结构
    if (/\bimport\s|\bexport\s/.test(code)) {
      console.log(`[worker] obfuscation skipped (ESM import/export present): ${file}`)
      return
    }
    const result = obfuscator
      .obfuscate(code, {
        compact: true,
        identifierNamesGenerator: 'hexadecimal',
        controlFlowFlattening: false,
        stringArray: true,
        stringArrayThreshold: 0.75,
        renameGlobals: false,
        selfDefending: false,
      })
      .getObfuscatedCode()
    // 语法校验：无法解析则回退原产物
    const { transform } = await import('esbuild')
    await transform(result, { loader: 'js', format: 'esm' })
    writeFileSync(file, result)
    console.log(`[worker] obfuscated: ${file}`)
  } catch (err) {
    console.log(`[worker] obfuscation skipped: ${err?.message ?? err}`)
  }
}

if (watchMode) {
  // watch 模式：esbuild 的 build() 不支持 watch 选项，须走 context().watch()
  const workerCtx = await context(workerOptions)
  await workerCtx.watch()
  const nativeCtx = hasNativeHost ? await context(nativeHostOptions) : null
  if (nativeCtx) await nativeCtx.watch()
  console.log(`[worker:watch] watching src/main -> ${workerOut}${hasNativeHost ? ` + ${path.join(distDir, 'native-host.js')}` : ''} (Ctrl+C to stop)`)
} else {
  mkdirSync(distDir, { recursive: true })
  await build(workerOptions)
  if (hasNativeHost) await build(nativeHostOptions)
  await obfuscateWorker(workerOut)
}
