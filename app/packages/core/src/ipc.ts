/**
 * IPC 通道常量。
 * 渲染层通道：render:setView / render:request / render:validate-call / render:ensure-worker / render:event-*。
 * 其余能力经 host-api 由 worker 调用，不经渲染层 IPC。
 */

export const RendererChannels = {
  /** 渲染层 → 主进程：PluginView 登记视图身份（view_id / plugin_id / sign_key） */
  SET_VIEW: 'render:setView',
  /** 渲染层 → 主进程：PluginView 卸载时注销视图身份（view_id） */
  UNSET_VIEW: 'render:unsetView',
  /** 渲染层 → 主进程：带签名的方法调用（view_id / plugin_id / method / args） */
  REQUEST: 'render:request',
  /** 渲染层 → 主进程：UI 端直连 host-api（view_id / method / args；docs/guides/ui-host-api.md） */
  HOST_API: 'render:host-api',
  /** 渲染层 → 主进程：跨插件直连前校验（view_id / call_plugin_id / method） */
  VALIDATE_CALL: 'render:validate-call',
  /** 渲染层 → 主进程：确保目标插件 worker 已启动（plugin_id） */
  ENSURE_WORKER: 'render:ensure-worker',
  /** 渲染层 → 主进程：查询已安装插件清单（PluginView 加载前判定插件是否已安装） */
  LIST_PLUGINS: 'render:list-plugins',
  /** 渲染层 → 主进程：解析插件组织标识（PluginView 挂载时注入 api.organization；返回 '@xxx' 或 null） */
  GET_PLUGIN_ORG: 'render:get-plugin-org',
  /** 渲染层 → 主进程：渲染层页面已就绪（宿主壳 mounted），主进程据此启动核心插件引导 */
  RENDERER_READY: 'render:renderer-ready',
  /** 渲染层 → 主进程：启动重试（非 dev 离线缺核心插件时，用户点「重试」重新走比较流程） */
  STARTUP_RETRY: 'render:startup-retry',
  /** 主进程 → 渲染层：核心插件引导进度（{ stage, detail }，宿主壳启动页据此更新提示） */
  STARTUP_PROGRESS: 'render:startup-progress',
  /** 渲染层 → 主进程：带签名的推送订阅（view_id / plugin_id / name） */
  EVENT_SUBSCRIBE: 'render:event-subscribe',
  /** 渲染层 → 主进程：取消订阅 */
  EVENT_UNSUBSCRIBE: 'render:event-unsubscribe',
  /** 主进程 → 渲染层：worker 推送分发（event / data） */
  EVENT: 'render:event',
  /** 主进程 → 渲染层：worker 直连 port 就绪（webContents.postMessage + transfer [port]） */
  PLUGIN_PORT_READY: 'render:plugin-port-ready',
  /** 主进程 → 渲染层：worker 退出 / 心跳超时（plugin_id / reason） */
  WORKER_EXITED: 'render:worker-exited',
  /** 主进程 → 渲染层：dev 插件产物变更（PluginView 据此 cache-bust 重载） */
  PLUGIN_CHANGED: 'render:plugin-changed',
  /** 主进程 → 渲染层：插件实例状态变更（{ runtime: PluginRuntime }，生命周期 12.3.5-① 广播） */
  PLUGIN_STATUS: 'render:plugin-status',
  /** 主进程 → 渲染层：窗口状态变化（{ maximized: boolean }，自绘标题栏更新按钮） */
  WINDOW_STATE: 'render:window-state',
  /** 主进程 → 渲染层：核心插件加载完成（基座壳据此加载 layout 主界面） */
  PLUGINS_READY: 'render:plugins-ready',
  /** 主进程 → 渲染层：登录状态变化（{ authenticated: boolean, user?: UserInfo }） */
  AUTH_STATE: 'render:auth-state',
  /** 主进程 → 渲染层：第三方账号绑定完成（{ provider }，设置页据此刷新绑定列表） */
  OAUTH_BIND: 'render:oauth-bind',
  /** 主进程 → 渲染层：主题变化（'dark' / 'light'；setting 插件 app.event 转发 / system 跟随 OS） */
  THEME: 'render:theme',
  /** 主进程 → 渲染层：语言变化（'zh-CN' / 'en-US'；setting 插件 app.event 转发） */
  LANGUAGE: 'render:language',
  /** 渲染层 → 主进程：读取插件自有日志（view_id / plugin_id / options；todo 任务 7.2.9） */
  READ_PLUGIN_LOGS: 'render:read-plugin-logs',
  /** 渲染层 → 主进程：清空本插件自有日志（view_id；LogViewer 删除图标用，只清自己） */
  CLEAR_PLUGIN_LOGS: 'render:clear-plugin-logs',
  /** 渲染层 → 主进程：宿主壳全局捕获的未处理前端错误（渲染层自身监听 window error/unhandledrejection；
   *  主进程从错误栈解析所属插件 dlientOpen://plugin/<id>/ 帧并写入该插件日志；解析失败回退主进程 renderer 日志） */
  CAPTURED_ERROR: 'render:captured-error',
  /** 主进程 → 独立确认视图：弹框请求（requestId + dialog + theme/locale + data；dialog/preload 桥，插件不可达） */
  DIALOG_REQUEST: 'dialog:request',
  /** 独立确认视图 → 主进程：弹框决策结果（requestId + ok + action + scope；主进程校验 sender + requestId） */
  DIALOG_REPLY: 'dialog:reply',
  /** 独立确认视图 → 主进程：preload/页面就绪握手（主进程就绪后再发请求，避免广播早于订阅丢失） */
  DIALOG_READY: 'dialog:ready',
  /** 主进程 → 独立确认视图：弹框超时/关闭通知（页面按 requestId 移除，避免超时后 DOM 残留泄漏） */
  DIALOG_CLOSE: 'dialog:close',
  /** 渲染层 → 主进程：批量申请跨插件能力（viewId + capabilities[]；签名 subject='request-permissions'） */
  REQUEST_PERMISSIONS: 'render:request-permissions',
  /** 主进程 → 渲染层：NOTIFY 事件通知（{ event, event_id, receiver, data, from }，receiver 定向匹配） */
  NOTIFY: 'render:notify',
  /** 独立通知条视图：页面就绪握手（notify/preload 桥，宿主独占，插件不可达） */
  NOTIFY_VIEW_READY: 'notify-view:ready',
  /** 主进程 → 通知条视图：全量栈下发（theme/locale + groups；通知条页面据此渲染） */
  NOTIFY_VIEW_SET: 'notify-view:set',
  /** 通知条视图 → 主进程：交互回传（{ id, event, payload }；主进程校验 sender） */
  NOTIFY_VIEW_EVENT: 'notify-view:event',
  /** 通知条视图 → 主进程：内容高度上报（{ height }；主进程 setBounds 收敛尺寸） */
  NOTIFY_VIEW_RESIZE: 'notify-view:resize',
} as const
