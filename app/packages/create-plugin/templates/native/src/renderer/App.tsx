/**
 * __PLUGIN_ID__ 主界面（src/renderer/App.tsx）。
 * 模板插件最小 UI：调用 worker 的 greet 方法展示一条消息。
 * 组件取自 '@dlient-open/ui'（shadcn 风格 primitives，lucide 图标），样式使用宿主 tokens.css 的 --dlient-* 变量（亮/暗随宿主 .dark 切换）。
 * 插件自有日志（示例）：api.log.write 直写插件日志目录（声明 manifest.permissions 的 log 即可，无需 fs 权限）；
 * LogViewer 查看/过滤/尾随。
 * 错误处理（示例）：请求统一 resolve 信封 { code, msg, data, from }，失败按 code 用 MessagePlugin 弹提示。
 */

import { useEffect, useState } from 'react'
import { Icon, Loading, LogViewer, useDlientApi, isApiOk, resolveApiMsg, defaultApiErrorMsg, toApiError, MessagePlugin } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import './styles.css'
import './i18n'

const NS = '__PLUGIN_ID__'

export default function App() {
  const api = useDlientApi()
  const { t, locale } = useI18n()
  const [greeting, setGreeting] = useState('')
  const [loading, setLoading] = useState(true)
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    // 忽略位：请求返回前组件可能已卸载（React 18 StrictMode 下 effect 还会执行两次），
    // 命中时直接丢弃结果，避免卸载后 setState。
    let alive = true
    void api.log.write('info', 'app mounted', { page: 'main' })
    void api
      .request<string>('__PLUGIN_ID__.greet')
      .then((res) => {
        if (!alive) return
        if (isApiOk(res)) {
          setGreeting(typeof res.data === 'string' ? res.data : '')
          void api.log.write('info', 'greet ok', { msg: res.data })
        } else {
          // 失败：信封带回 code / msg，按 code 弹统一提示（优先多语言 msg，其次默认文案）
          setGreeting('')
          void api.log.write('error', 'greet failed', { errCode: res.code })
          MessagePlugin.error(resolveApiMsg(res.msg, locale) || defaultApiErrorMsg(res.code, locale))
        }
      })
      .catch((err) => {
        if (!alive) return
        // 兜底：契约保证请求 resolve 信封不 throw，此处仅防御异常（规整为 ApiError 提示）
        void api.log.write('error', 'greet failed', { errCode: (err as { code?: number })?.code ?? -1 })
        setGreeting('')
        MessagePlugin.error(toApiError(err, locale).message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [api, locale])

  return (
    <div className="demo-root">
      <Icon name="code" size={48} />
      <h1 className="demo-title">{t(`${NS}.title`)}</h1>
      {loading ? <Loading text={t(`${NS}.loading`)} /> : <p className="demo-text">{greeting || t(`${NS}.greetFailed`)}</p>}
      <button type="button" onClick={() => setShowLogs((s) => !s)} className="demo-btn">
        {showLogs ? t(`${NS}.logsHide`) : t(`${NS}.logsShow`)}
      </button>
      {showLogs && <LogViewer className="demo-logs" />}
    </div>
  )
}
