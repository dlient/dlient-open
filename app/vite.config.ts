import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const alias = {
  // core 为宿主主进程核心库，【最高优先级规则】不发布线上，恒用本地源码
  '@dlient-open/core': path.resolve(__dirname, 'packages/core/src'),
  // ui / api-bridge / i18n 同样恒用本地源码：它们经 SystemJS 由宿主共享给插件，
  // 本地源码（含信封解析 helpers：isApiOk / apiOr / toApiError …）编译进宿主渲染进程后，
  // 共享模块即携带最新导出，插件无需各自 alias / 升级 registry 包。
  // （registry 线上包未同步本地 helper 导出时，alias 保证单源一致。）
  '@dlient-open/ui': path.resolve(__dirname, 'packages/ui/src'),
  '@dlient-open/api-bridge': path.resolve(__dirname, 'packages/api-bridge/src'),
  '@dlient-open/i18n': path.resolve(__dirname, 'packages/i18n/src'),
  // 主进程侧包（plugin-sdk / api-types / native-host-sdk）同样恒用本地源码：
  // workspace 源码链接（无预构建 dist），alias 直接指向入口文件（指向目录会令 commonjs
  // resolver 按包 main/exports 解析到不存在的 dist）。
  '@dlient-open/plugin-sdk': path.resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
  '@dlient-open/api-types': path.resolve(__dirname, 'packages/api-types/src/index.ts'),
  '@dlient-open/native-host-sdk': path.resolve(__dirname, 'packages/native-host-sdk/src/index.ts'),
}

// 注意：vite-plugin-electron 的 main / preload 是**独立 vite 构建**（内部 configFile: false），
// 既不继承本文件的 resolve.alias，也不读 tsconfig 的 paths。若不显式传入 alias，它们会经
// node_modules 解析到 workspace 包的 package.json（main/exports → packages/*/dist），而 dist 不入库，
// 于是在没有预构建的环境（CI / 全新克隆）会报 “Failed to resolve entry for package ...”。
// 故以下两个子构建都显式带上 alias（与 tsconfig paths 一致：恒用本地源码）。
const electronConfigs = {
  main: {
    // 多入口：主进程 + 共享 worker 池运行时（pool-worker，utilityProcess.fork 目标）
    entry: {
      index: 'src/main/index.ts',
      'pool-worker': 'packages/core/src/pool-worker.ts',
    },
    vite: { resolve: { alias } },
  },
  preload: {
    input: path.join(__dirname, 'src/preload/index.ts'),
    vite: { resolve: { alias } },
  },
  renderer: process.env.NODE_ENV === 'test' ? undefined : {},
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    electron(electronConfigs),
  ],

  resolve: {
    alias,
  },
  // dev 依赖预打包：@dlient-open/i18n、@dlient-open/api-bridge 预打包成独立 chunk，@dlient-open/ui（registry dist
  // 包）exclude 不预打包 —— 若预打包 @dlient_ui.js 会把 @dlient-open/i18n 内联进去，形成双实例
  // （I18nContext 分裂 → 插件 useI18n 报 I18nProvider 缺失）。exclude 后 ui 以原生 ESM 加载，
  // 其 `import '@dlient-open/i18n'` 等由 vite 重写到共享预打包 URL，保证单实例。
  // systemjs（插件模块加载器，UMD）一并预打包，供 PluginView 运行时注册共享模块。
  // lucide-react：@dlient-open/ui（本地源码 alias）的图标实现，预打包供共享解析（System.register 产物
  // 与宿主 ESM 直接引用的模块需保持同一实例）。
  optimizeDeps: {
    include: [
      '@dlient-open/i18n',
      '@dlient-open/api-bridge',
      'systemjs',
      'lucide-react',
    ],
    exclude: ['@dlient-open/ui'],
  },

  // 产物 chunk 拆分：react 系归并 vendor chunk；lucide 与 @dlient-open/ui 已随宿主 alias 打包。
  build: {
    rollupOptions: {
      // Electron 内置模块 original-fs（未打 asar 补丁的原始 fs，读 .asar 文件本体用）→ 保持 external
      external: ['original-fs'],
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/lucide-react')) return 'lucide'
        },
      },
    },
  },
}))
