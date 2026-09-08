/**
 * @dlient-open/api-bridge 库构建（vite lib mode，ESM）。
 * react 保持 external（peerDependencies）：运行时与宿主/插件共享同一 react 实例。
 * 产物为纯 ESM + external，由宿主经 SystemJS registry 以单实例提供，不被打包进插件产物。
 */
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
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
      // 仅 external react（及子路径）
      external: [/^react/],
    },
  },
})
