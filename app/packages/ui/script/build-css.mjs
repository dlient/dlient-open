/**
 * @dlient-open/ui 样式预编译脚本（Tailwind v4，官方 CLI 编译）。
 * 把 src/styles/base.css 用 @tailwindcss/cli 编译成静态 CSS，输出 src/styles/ui.css ——
 * 组件以 import ui.css?inline 拿到字符串，运行期由 ensureUiStyles() 注入一次 <style>。
 * 产物自包含，宿主/插件无需安装 tailwind。
 *
 * 变更组件 className 后需重跑本脚本（npm run build:css），再执行 vite build。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('..', import.meta.url))
const inputPath = `${dir}src/styles/base.css`
const outputPath = `${dir}src/styles/ui.css`

/** workspace 依赖提升到仓库根 node_modules：本地 .bin 不存在时逐级向上查找 tailwindcss */
function findTailwindBin() {
  const exe = process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss'
  let cur = dir
  for (;;) {
    const probe = join(cur, 'node_modules', '.bin', exe)
    if (existsSync(probe)) return probe
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  throw new Error('build-css: tailwindcss binary not found (install @tailwindcss/cli)')
}

const bin = findTailwindBin()

const r = spawnSync(bin, ['-i', inputPath, '-o', outputPath, '--minify'], { stdio: 'inherit', cwd: dir, shell: process.platform === 'win32' })
if (r.status !== 0) process.exit(r.status ?? 1)

// 前缀(dui)下 tailwind 默认主题变量以 --dui-* 命名（--dui-spacing），
// 但 tw-animate-css 自定义 @utility（slide-in-from-* 等）体内仍字面引用 var(--spacing)，
// 生成后未改写 → 这里做精确替换，保证动画位移类可正常计算。
let css = readFileSync(outputPath, 'utf8')
css = css.replaceAll('var(--spacing)', 'var(--dui-spacing)')
writeFileSync(outputPath, css)

const kb = (statSync(outputPath).size / 1024).toFixed(1)
console.log(`build-css: ${kb} KiB -> src/styles/ui.css`)
