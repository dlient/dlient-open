// 冒烟测试：开源版 SystemJS 共享模块（含旧名 @dlient/* 垫片）能否加载旧 .dlient 的 remoteEntry.js
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const System = new (await import(pathToFileURL('E:/dlient-v3/dlient-open/app/node_modules/systemjs/dist/system.js').href)).default()

// —— 复刻 PluginView.ensureSystemShared：同值对象注册新名 + 旧名，import map 映射到共享 URL ——
const uiMod = { default: { __tag: 'ui-module' }, useDlientApi: () => ({}) }
const i18nMod = { default: { __tag: 'i18n-module' }, useI18n: () => ({ t: (k) => k, locale: 'zh-CN' }) }
const bridgeMod = { default: { __tag: 'bridge-module' }, createHostApiProxy: () => ({}) }
const SHARED_MODULES = {
  react: { default: { __tag: 'react' } },
  'react/jsx-runtime': { __tag: 'jsx-runtime' },
  'react-dom': { default: { __tag: 'react-dom' } },
  'react-dom/client': { __tag: 'react-dom-client' },
  '@dlient-open/api-bridge': bridgeMod,
  '@dlient-open/i18n': i18nMod,
  '@dlient-open/ui': uiMod,
  '@dlient/api-bridge': bridgeMod,
  '@dlient/i18n': i18nMod,
  '@dlient/ui': uiMod,
}
const imports = {}
for (const name of Object.keys(SHARED_MODULES)) {
  const url = `dlientV3://shared/${name.replace(/\//g, '_').replace(/@/g, '')}`
  imports[name] = url
  System.set(url, SHARED_MODULES[name])
}
System.addImportMap({ imports })

// 打印旧包 System.register 依赖（验证它引用的就是旧名）
const oldRemote = 'E:/dlient-v3/plugins/plugin-ui/dist/remoteEntry.js'
const s = readFileSync(oldRemote, 'utf8')
const m = s.match(/System\.register\(\s*\[([^\]]*)\]/)
console.log('旧包 deps:', m ? m[1] : '(none)')

// 模拟 dlientV3://plugin/plugin-ui/dist/remoteEntry.js 可加载：通过 import map 指向文件 URL
const remoteUrl = 'file:///E:/dlient-v3/plugins/plugin-ui/dist/remoteEntry.js'
System.addImportMap({ imports: { 'dlientV3://plugin/plugin-ui/dist/remoteEntry.js': remoteUrl } })

System.import('dlientV3://plugin/plugin-ui/dist/remoteEntry.js')
  .then((mod) => {
    console.log('OK: 旧包 remoteEntry 加载成功，导出 keys =', Object.keys(mod).join(', '))
    process.exit(0)
  })
  .catch((err) => {
    console.error('FAIL:', err && err.message)
    process.exit(1)
  })
