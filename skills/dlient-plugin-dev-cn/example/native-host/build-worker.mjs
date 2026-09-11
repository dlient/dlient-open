// 用 esbuild 构建 worker：打包 src/main/index.ts -> <dist>/worker.js（worker 入口）。
// 用法：node build-worker.mjs                    一次性构建（默认 dist）
//       node build-worker.mjs --outdir <dir>     写到另一个产物目录（npm run pack 复用
//                                                构建链，构建到 pack/<version>/dist）
//       node build-worker.mjs --watch            源码变更即重建（开发热重载）
//
// 原生模块（native-host 模式，见 references/native-host.md）：
//   - 若 manifest 声明了 dlient.nativeModules.dependencies，这些包保持 `external`，
//     由官方 Node 子进程（<dist>/native-host.js）在运行时从插件的 node_modules 解析；
//   - 若 src/native-host/index.ts 存在，则额外产出 <dist>/native-host.js（纯 Node 入口，
//     platform: node）；
//   - dlient.packLoose 声明的根级 *.js 条目（native-host.js 与含 '/' 的条目除外）
//     由 src/native-host/<name>.ts 编译到 <dist>/<name>.js（如 native1.js <- native1.ts）：
//     这些由宿主用官方 Node 拉起，必须是真实文件。缺失的 .ts 会被跳过
//     （视为已构建好的产物）。
import { build, context } from 'esbuild'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const watchMode = process.argv.includes('--watch')
// --outdir：pack 会把 worker 构建到 pack/<version>/dist，不触碰开发期的 dist。
const outdirIdx = process.argv.indexOf('--outdir')
const distDir = outdirIdx !== -1 && process.argv[outdirIdx + 1]
  ? path.resolve(__dirname, '..', process.argv[outdirIdx + 1])
  : path.join(__dirname, '..', 'dist')
const workerOut = path.join(distDir, 'worker.js')

// 原生模块（manifest dlient.nativeModules.dependencies）-> esbuild external（不打包 .node）。
let manifest = {}
try {
  manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
} catch {
  /* package.json 缺失/损坏：视为无原生模块 */
}
const nativePkgs = Object.keys(manifest?.dlient?.nativeModules?.dependencies ?? {})

const baseOptions = {
  bundle: true,
  platform: 'node',
  // 插件 package.json 声明了 type: module，所以宿主以 ESM 加载 worker
  // —— 产物必须是 ESM（CJS 的 require/module.exports 会以 "module is not defined" 崩溃）。
  format: 'esm',
  target: 'node20',
  external: ['electron', ...nativePkgs],
  // 生产：minify；watch（开发）：保持可读以便调试。
  minify: !watchMode,
  logLevel: 'info',
}

const workerOptions = {
  ...baseOptions,
  entryPoints: [path.join(__dirname, '..', 'src/main/index.ts')],
  outfile: workerOut,
}

// native-host 入口（存在时自动产出 <dist>/native-host.js）：纯 Node，
// 原生模块 external；运行时经 createRequire 从插件 node_modules 解析
// （ABI 与官方 Node 一致，故无需 @electron/rebuild）。
const nativeHostEntry = path.join(__dirname, '..', 'src/native-host/index.ts')
const hasNativeHost = existsSync(nativeHostEntry)
const nativeHostOptions = {
  ...baseOptions,
  entryPoints: [nativeHostEntry],
  outfile: path.join(distDir, 'native-host.js'),
}

// dlient.packLoose 声明的其它官方 Node 拉起入口（native1.js/native2.js…）：
// 把 src/native-host/<name>.ts 编译到 <dist>/<name>.js（选项与 native-host.js 相同）。
const nativeEntryDefs = (Array.isArray(manifest?.dlient?.packLoose) ? manifest.dlient.packLoose : [])
  .map((v) => String(v ?? '').trim())
  .filter((f) => !!f && !f.includes('/') && f.endsWith('.js') && f !== 'native-host.js')
  .map((f) => ({
    name: f.slice(0, -3),
    out: f,
    src: path.join(__dirname, '..', 'src', 'native-host', `${f.slice(0, -3)}.ts`),
  }))
  .filter((e) => existsSync(e.src))
const nativeEntryOptions = nativeEntryDefs.map((e) => ({
  ...baseOptions,
  entryPoints: [e.src],
  outfile: path.join(distDir, e.out),
}))

// 可选加固：生产构建后对 worker.js 做混淆。
// 未安装 javascript-obfuscator 时跳过（绝不阻塞构建）；混淆只作用于
// esbuild 产物，因此 import/export 说明符与 RPC 方法名（运行时字符串）不受
// 影响。结果会做语法检查，失败则回退到未混淆的 bundle。
async function obfuscateWorker(file) {
  try {
    const { default: obfuscator } = await import('javascript-obfuscator')
    const { readFileSync, writeFileSync } = await import('node:fs')
    const code = readFileSync(file, 'utf-8')
    // 跳过含 import/export 的 ESM 产物：混淆器可能破坏模块说明符/导出。
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
    // 语法检查：无法解析则回退到原始 bundle。
    const { transform } = await import('esbuild')
    await transform(result, { loader: 'js', format: 'esm' })
    writeFileSync(file, result)
    console.log(`[worker] obfuscated: ${file}`)
  } catch (err) {
    console.log(`[worker] obfuscation skipped: ${err?.message ?? err}`)
  }
}

if (watchMode) {
  // watch 模式：esbuild 的 build() 没有 watch 选项，因此用 context().watch()。
  const workerCtx = await context(workerOptions)
  await workerCtx.watch()
  const nativeCtxs = [...(hasNativeHost ? [nativeHostOptions] : []), ...nativeEntryOptions]
  const nativeWatches = await Promise.all(nativeCtxs.map((o) => context(o)))
  for (const c of nativeWatches) await c.watch()
  const nativeOuts = [
    ...(hasNativeHost ? [path.join(distDir, 'native-host.js')] : []),
    ...nativeEntryDefs.map((e) => path.join(distDir, e.out)),
  ]
  console.log(`[worker:watch] watching src/main -> ${workerOut}${nativeOuts.length ? ` + ${nativeOuts.join(' + ')}` : ''} (Ctrl+C to stop)`)
} else {
  mkdirSync(distDir, { recursive: true })
  await build(workerOptions)
  if (hasNativeHost) await build(nativeHostOptions)
  for (const o of nativeEntryOptions) await build(o)
}
