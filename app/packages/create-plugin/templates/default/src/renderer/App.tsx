/**
 * __PLUGIN_ID__ 主界面（src/renderer/App.tsx）。
 * 模板插件最小 UI（**default 模式：纯 UI，无 worker**）：
 *  - 页面逻辑全部在渲染层；宿主能力经 api.* 直连调用（UI host-api 白名单，见 .agent/references/ui-api.md）；
 *  - 本模板只用到 log.write（manifest.permissions 已声明 log），无需任何后台进程；
 *  - 需要后台逻辑（RPC / 子进程 / 原生模块）时，按 .agent/references/mode-switch-*.md 切换到 worker / native-host 模式。
 * 组件取自 '@dlient-open/ui'；样式使用宿主 tokens.css 的 --dlient-* 变量（亮/暗随宿主 .dark 切换）。
 */

import { useCallback, useState } from 'react'
import { Icon, LogViewer, useDlientApi } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import './styles.css'
import './i18n'

const NS = '__PLUGIN_ID__'

export default function App() {
  const api = useDlientApi()
  const { t } = useI18n()
  const [count, setCount] = useState(0)
  const [showLogs, setShowLogs] = useState(false)

  // 纯 UI 插件没有 worker：所有逻辑在渲染层完成，宿主能力经 api.* 调用（示例：写一条插件日志）
  const onClick = useCallback(() => {
    const next = count + 1
    setCount(next)
    void api.log.write('info', 'button clicked', { count: next })
  }, [api, count])

  return (
    <div className="demo-root">
      <Icon name="code" size={48} />
      <h1 className="demo-title">{t(`${NS}.title`)}</h1>
      <p className="demo-text">{t(`${NS}.hint`)}</p>
      <button type="button" onClick={onClick} className="demo-btn">
        {count > 0 ? t(`${NS}.clicked`, { count }) : t(`${NS}.click`)}
      </button>
      <button type="button" onClick={() => setShowLogs((s) => !s)} className="demo-btn">
        {showLogs ? t(`${NS}.logsHide`) : t(`${NS}.logsShow`)}
      </button>
      {showLogs && <LogViewer className="demo-logs" />}
    </div>
  )
}
