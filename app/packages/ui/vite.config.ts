/**
 * @dlient-open/ui 库构建（vite lib mode，ESM）。
 * external 策略：本地源码打包进产物；所有 bare import（react、@dlient-open/i18n、@dlient-open/api-bridge、
 * lucide-react）保持 external，由消费方（宿主）解析：
 *   - lucide-react 在宿主安装并随宿主 bundle / SystemJS 共享解析；
 *   - 产物是纯 ESM + external，SystemJS 加载时无需改写。
 * 样式：primitives / modal 样式以 ?inline 注入，本包不输出独立 CSS 文件；
 *       颜色/几何/排版全部引用宿主 tokens.css 的 --dlient-* 变量。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // plugin-view.tsx 以包名自引用 @dlient-open/ui（共享命名空间），映射回 src 打包进产物
      '@dlient-open/ui': path.resolve(__dirname, 'src'),
      // shadcn 生成组件使用 @/ 别名（components.json aliases）
      '@': path.resolve(__dirname, 'src'),
    },
  },
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
      external: [
        /^react/,
        /^@dlient-open\/i18n/,
        /^@dlient-open\/api-bridge/,
        /^systemjs$/,
        /^lucide-react/,
      ],
    },
  },
})
