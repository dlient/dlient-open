// Build the worker with esbuild: bundle src/main/index.ts -> <dist>/worker.js (worker entry).
// Usage: node build-worker.mjs                    one-off build (default dist)
//        node build-worker.mjs --outdir <dir>     write to another output dir (npm run pack reuses the
//                                                 build chain and builds into pack/<version>/dist)
//        node build-worker.mjs --watch            rebuild on source change (dev hot reload)
//
// Native modules (native-host mode, see references/native-host.md):
//   - if the manifest declares dlient.nativeModules.dependencies, those packages are kept `external`
//     and are resolved at runtime from the plugin's node_modules by the official-Node child
//     (<dist>/native-host.js);
//   - if src/native-host/index.ts exists, an extra <dist>/native-host.js is emitted (pure Node entry,
//     platform: node);
//   - root-level *.js entries declared in dlient.packLoose (except native-host.js / entries with '/')
//     are compiled from src/native-host/<name>.ts to <dist>/<name>.js (e.g. native1.js <- native1.ts):
//     these are spawned by the host with official Node and must stay real files. Missing .ts files are
//     skipped (treated as already-built artifacts).
import { build, context } from 'esbuild'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const watchMode = process.argv.includes('--watch')
// --outdir: pack builds the worker into pack/<version>/dist without touching the dev-time dist.
const outdirIdx = process.argv.indexOf('--outdir')
const distDir = outdirIdx !== -1 && process.argv[outdirIdx + 1]
  ? path.resolve(__dirname, '..', process.argv[outdirIdx + 1])
  : path.join(__dirname, '..', 'dist')
const workerOut = path.join(distDir, 'worker.js')

// Native modules (manifest dlient.nativeModules.dependencies) -> esbuild external (do not bundle .node).
let manifest = {}
try {
  manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
} catch {
  /* missing/broken package.json: treat as no native modules */
}
const nativePkgs = Object.keys(manifest?.dlient?.nativeModules?.dependencies ?? {})

const baseOptions = {
  bundle: true,
  platform: 'node',
  // The plugin package.json declares type: module, so the host loads the worker
  // as ESM — output must be ESM (CJS require/module.exports would crash with "module is not defined").
  format: 'esm',
  target: 'node20',
  external: ['electron', ...nativePkgs],
  // Production: minify; watch (dev): keep readable for debugging.
  minify: !watchMode,
  logLevel: 'info',
}

const workerOptions = {
  ...baseOptions,
  entryPoints: [path.join(__dirname, '..', 'src/main/index.ts')],
  outfile: workerOut,
}

// native-host entry (emitted automatically as <dist>/native-host.js when present): pure Node,
// native modules external; resolved at runtime via createRequire from the plugin node_modules
// (ABI matches official Node, so no @electron/rebuild).
const nativeHostEntry = path.join(__dirname, '..', 'src/native-host/index.ts')
const hasNativeHost = existsSync(nativeHostEntry)
const nativeHostOptions = {
  ...baseOptions,
  entryPoints: [nativeHostEntry],
  outfile: path.join(distDir, 'native-host.js'),
}

// Other official-Node spawn entries declared in dlient.packLoose (native1.js/native2.js…):
// compile src/native-host/<name>.ts to <dist>/<name>.js (same options as native-host.js).
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

// Optional hardening: obfuscate worker.js after a production build.
// Skipped when javascript-obfuscator is not installed (never blocks the build); obfuscation only
// touches the esbuild output, so import/export specifiers and RPC method names (runtime strings) are
// unaffected. The result is syntax-checked and falls back to the un-obfuscated bundle on failure.
async function obfuscateWorker(file) {
  try {
    const { default: obfuscator } = await import('javascript-obfuscator')
    const { readFileSync, writeFileSync } = await import('node:fs')
    const code = readFileSync(file, 'utf-8')
    // Skip ESM output that contains import/export: the obfuscator can break module specifiers/exports.
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
    // Syntax check: fall back to the original bundle if it cannot be parsed.
    const { transform } = await import('esbuild')
    await transform(result, { loader: 'js', format: 'esm' })
    writeFileSync(file, result)
    console.log(`[worker] obfuscated: ${file}`)
  } catch (err) {
    console.log(`[worker] obfuscation skipped: ${err?.message ?? err}`)
  }
}

if (watchMode) {
  // Watch mode: esbuild's build() has no watch option, so use context().watch().
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
