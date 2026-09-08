/**
 * @dlient-open/i18n 库构建（vite lib mode，ESM）。
 * react 保持 external（peerDependencies，不内嵌）：
 *   - 保证运行时 react 与宿主/插件共享实例一致（单例，宿主经 SystemJS registry 提供）；
 * 本地相对/绝对路径源码打包进产物；其余 bare import 一律 external。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist',
    target: 'esnext',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      // 仅 external react（及子路径）：保证入口 src/ 源码打包进产物
      external: [/^react/],
    },
  },
})
