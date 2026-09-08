/**
 * @dlient-open/api-types 库构建（vite lib mode，ESM）。纯类型 + 极简常量，无运行时 peer 依赖。
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
  },
})
