/**
 * @dlient-open/ui tailwind 占位配置。
 * 编译已完全 CSS-first（见 src/styles/base.css 的 `@import "tailwindcss" prefix(dui)`），
 * 本文件仅保留给 shadcn CLI / components.json 读取（prefix 决定 CLI 落盘类名前缀 dui-）。
 * Tailwind v4 会忽略 content / theme；这里不再 require 任何插件。
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: 'dui',
}
