/**
 * modal 样式注入。
 *
 * @dlient-open/ui 是纯 ESM 库（vite lib mode），构建不输出独立 CSS 文件（见包根 vite.config.ts
 * 注释「本包不再输出样式」）；而 modal 有自有视觉样式（style.css / dialog.css），
 * 且同一份 @dlient-open/ui 在宿主与插件间经 SystemJS 共享单实例。
 * 因此这里把两份 CSS 以 `?inline` 打包成字符串，首次打开弹框时按 id 去重注入 <style>，
 * 任何消费形态（宿主打包 / 插件共享）都自动生效，无需消费方手动引 CSS。
 * CSS 内部仅引用宿主 tokens.css 的 --dlient-* 变量，无自定义变量。
 */
import styleCss from './style.css?inline'
import dialogCss from './dialog.css?inline'

const STYLES: ReadonlyArray<readonly [id: string, css: string]> = [
  ['dui-modal-style', styleCss],
  ['dui-modal-dialog-style', dialogCss],
]

function inject(id: string, css: string): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = css
  document.head.appendChild(el)
}

let ensured = false

/** 幂等注入两份样式（懒加载：首次弹框打开时调用） */
export function ensureModalStyles(): void {
  if (ensured) return
  ensured = true
  for (const [id, css] of STYLES) inject(id, css)
}
