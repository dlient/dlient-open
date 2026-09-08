/**
 * dialog/preload.js - 独立确认视图 preload（纯 JS，随 dialog/index.html 一起静态打包，无构建步骤）。
 *
 * 只存在于宿主主进程创建的确认视图（WebContentsView）内，与共享渲染层（window.dlient）完全隔离：
 * 插件代码加载不进该视图，也触达不到这里的 onRequest / reply。
 * 沙箱 preload 可用 electron 子集（contextBridge / ipcRenderer），无需 Node 完整能力。
 *
 *  - onRequest(cb)：主进程 DIALOG_REQUEST → 页面渲染弹框
 *  - reply(result)：页面决策 → 主进程 DIALOG_REPLY（主进程校验 sender + requestId）
 *  - ready()：页面就绪握手，主进程等 ready 后再发请求，避免广播早于订阅丢失
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dlientDialog', {
  onRequest: (cb) => {
    ipcRenderer.on('dialog:request', (_event, req) => {
      try {
        cb(req)
      } catch (err) {
        console.error('[dialog] onRequest handler error:', err)
      }
    })
  },
  reply: (result) => {
    ipcRenderer.send('dialog:reply', result)
  },
  ready: () => {
    ipcRenderer.send('dialog:ready')
  },
  onClose: (cb) => {
    ipcRenderer.on('dialog:close', (_event, r) => {
      try {
        cb(r)
      } catch (err) {
        console.error('[dialog] onClose handler error:', err)
      }
    })
  },
})
