/**
 * notify/preload.js - 独立通知条视图 preload（纯 JS，随 notify/index.html 一起静态打包，无构建步骤）。
 *
 * 只存在于宿主主进程创建的通知条视图（WebContentsView）内，与共享渲染层（window.dlient）完全隔离：
 * 插件代码加载不进该视图，也触达不到这里的 onSet / emit。
 * 沙箱 preload 可用 electron 子集（contextBridge / ipcRenderer）。
 *
 *  - ready()：页面就绪握手，主进程等 ready 后再下发栈数据，避免广播早于订阅丢失
 *  - onSet(cb)：主进程 NOTIFY_VIEW_SET → 全量栈（theme/locale/groups）渲染
 *  - emit(event)：页面交互 → 主进程 NOTIFY_VIEW_EVENT（主进程校验 sender）
 *  - resize(height)：页面 ResizeObserver 上报内容高度 → 主进程 setBounds 收敛尺寸
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dlientNotify', {
  onSet: (cb) => {
    ipcRenderer.on('notify-view:set', (_event, payload) => {
      try {
        cb(payload)
      } catch (err) {
        console.error('[notify] onSet handler error:', err)
      }
    })
  },
  emit: (event) => {
    ipcRenderer.send('notify-view:event', event)
  },
  resize: (height) => {
    ipcRenderer.send('notify-view:resize', { height: Math.max(0, Math.ceil(height)) })
  },
  ready: () => {
    ipcRenderer.send('notify-view:ready')
  },
})
