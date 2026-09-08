/**
 * @dlient-open/plugin-sdk 库构建（vite lib mode，ESM）。
 * vite / @vitejs/plugin-react 保持 external（vite-config 工具函数用，
 * 仅被插件构建期消费，不随产物发布）。types/protocol/worker 均为自包含逻辑，无外部依赖。
 * core 反向依赖本包（领域类型与协议类型的来源）。
 */
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  build: {
    lib: {
      // 双入口：主入口（types/protocol/worker，零外部依赖）+ vite-config 子入口
      // （插件构建期工具，vite 生态保持 external）
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'vite-config': path.resolve(__dirname, 'src/vite-config.ts'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.mjs`,
    },
    outDir: 'dist',
    target: 'esnext',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      // external vite 生态（vite-config 的 import）+ node 内置（vite-config 读 package.json 用）
      external: [/^vite$/, /^vite\//, /^@vitejs\/plugin-react$/, /^node:/],
    },
  },
})
