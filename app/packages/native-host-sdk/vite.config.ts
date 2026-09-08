/**
 * @dlient-open/native-host-sdk 库构建（vite lib mode，ESM）。
 * 纯 Node 包：仅 external node: 内置模块（其余内联进 dist），无任何运行时依赖。
 */
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'example-host': path.resolve(__dirname, 'src/example-host.ts'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.mjs`,
    },
    outDir: 'dist',
    target: 'node20',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [/^node:/],
    },
  },
})
