/**
 * createPluginViteConfig - 插件 UI 构建预设（System.register 格式，宿主用 SystemJS 加载）。
 *
 * 纯构建预设：vite build 产出 System.register 格式 remoteEntry.js，react 系与 @dlient-open/* 全部
 * external（宿主 SystemJS registry 单实例）；CSS 合并单文件由 dlient:css-link 注入 <link>。
 * 插件开发热重载走产物级：npm run dev:watch（vite build --watch）写 dist → 宿主 fs.watch 广播
 * plugin-changed → PluginView cache-bust 整模块重载。
 */

import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cssScope } from './css-scope.ts'

export interface PluginViteConfigOptions {
  pluginId: string
  pluginDir: string
  hasWorker: boolean
  uiEntry?: string
  workerEntry?: string
}

export function createPluginViteConfig(options: PluginViteConfigOptions): UserConfig {
  const { pluginDir, pluginId, uiEntry = 'src/renderer/App.tsx' } = options

  return defineConfig({
    root: pluginDir,
    plugins: [
      react(),
      // System.register 格式的 JS 不产出 CSS 引用（esm 会有 import './x.css'），而插件的
      // remoteEntry.js 由宿主经 SystemJS 动态加载（无 HTML 流程）。这里把 CSS 保留为
      // 独立文件，并在入口 chunk 注入 <link>：样式经 dlientOpen:// 协议加载；CSS 内 url()
      // 相对路径由浏览器按 CSS 文件位置解析，可正确引用插件内资源（不内联、无需重写）。
      {
        name: 'dlient:css-link',
        enforce: 'post',
        generateBundle(_b, bundle) {
          const css = Object.values(bundle).find(
            (b) => b.type === 'asset' && typeof b.source === 'string' && b.fileName.endsWith('.css'),
          ) as unknown as { fileName: string; source: string } | undefined
          if (!css) return
          const entry = Object.values(bundle).find((b) => b.type === 'chunk' && b.isEntry) as unknown as
            | { code: string }
            | undefined
          if (!entry) return
          // 版本戳：dev 热重载 / 插件升级后 href 变化，避免浏览器缓存旧 style.css。
          // 同源 link 用唯一 id 标识，每次注入先移除旧的：热重载多次执行时避免累积多个
          // stylesheet 导致旧样式残留叠加。
          entry.code += `\n;(function(){var prev=document.getElementById('dlient-css-${pluginId}');if(prev)prev.remove();var l=document.createElement('link');l.id='dlient-css-${pluginId}';l.rel='stylesheet';l.href='dlientOpen://plugin/${pluginId}/dist/${css.fileName}?v=${Date.now()}';document.head.appendChild(l);})();`
        },
      },
    ],
    build: {
      outDir: 'dist',
      // worker 产物（dist/worker.js）与 UI 共享同一 dist，且 worker 不经 vite 构建；
      // 关闭 emptyOutDir，避免 vite build 清空 dist 时误删 worker.js。
      emptyOutDir: false,
      target: 'esnext',
      // 方案 build.md 2.2：UI 端 JS 仅压缩（不混淆——System.register 结构 / import map 裸依赖
      // / 入口导出会被混淆器破坏）。产物始终不带 sourcemap，避免源码经 dlientOpen:// 泄露。
      minify: 'esbuild',
      sourcemap: false,
      // CSS 压缩（esbuild）：vite 5 的 cssMinify 不跟随 minify，需显式开启。
      cssMinify: 'esbuild',
      modulePreload: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          main: uiEntry,
        },
        // 入口导出由宿主（SystemJS import）在运行时消费：'exports-only' 会把默认导出
        // 当作未使用 tree-shake 掉，必须 'strict' 保留入口全部导出。
        preserveEntrySignatures: 'strict',
        // react 系与 @dlient-open/* 全部 external：运行时从宿主 SystemJS registry 解析单实例
        // （见 @dlient-open/ui PluginView 的 ensureSystemShared）。
        // lucide-react 同理由宿主共享（经 @dlient-open/ui re-export，插件不直接 import 时无需 entry）。
        external: [
          'react',
          'react/jsx-runtime',
          'react-dom',
          'react-dom/client',
          '@dlient-open/api-bridge',
          '@dlient-open/i18n',
          '@dlient-open/ui',
          'lucide-react',
        ],
        output: {
          format: 'system',
          entryFileNames: 'remoteEntry.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
    css: {
      // 插件 CSS 作用域（docs/specs/plugin-css-scope.md）：内置 PostCSS 前缀改写，
      // 存量插件与模板零改动；`*.module.css` 由 vite 默认按 CSS Modules 处理（hash 类名）。
      postcss: {
        plugins: [cssScope({ pluginId })],
      },
    },
  } as UserConfig)
}
