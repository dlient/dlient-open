/**
 * dsh 主界面（src/renderer/App.tsx）。
 * 启动 DSH web 服务（worker），就绪后用 webview 插件（Webview 组件）内嵌 http://127.0.0.1:<port>。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, Icon, Loading, useDlientApi, Webview, isApiOk, resolveApiMsg, defaultApiErrorMsg } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import './styles.css'
import './i18n'

const NS = 'dsh'

interface DshStatus {
  phase: 'idle' | 'checking-node' | 'installing-dsh' | 'starting' | 'ready' | 'error'
  url?: string
  error?: string
  /** 是否启动过：stop 后为 true，用于区分「从未启动（自动启动）」与「已停止（不自动重启）」 */
  startedOnce?: boolean
}

/** 注入 dsh 页面的主题脚本：html color-scheme + body data-ds-dark-theme（body 未就绪时延迟到 DOMContentLoaded） */
function dshThemeScript(isDark: boolean): string {
  const scheme = isDark ? 'dark' : 'light'
  return `(() => {
  const isDark = ${isDark};
  const apply = () => {
    document.documentElement.style.colorScheme = '${scheme}';
    if (isDark) document.body.setAttribute('data-ds-dark-theme', '');
    else document.body.removeAttribute('data-ds-dark-theme');
  };
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();`
}

export default function App() {
  const api = useDlientApi()
  const { t, locale } = useI18n()
  const [status, setStatus] = useState<DshStatus>({ phase: 'idle' })
  const [viewId, setViewId] = useState<string | null>(null)
  const startingRef = useRef(false)

  /** 把当前主题应用到 dsh webview（executeJavaScript，白名单校验在主进程 webview-manager） */
  const applyThemeToWebview = useCallback(
    (id: string, isDark: boolean) => {
      return api
        .request('webview:webContents:call', [{ viewId: id, method: 'executeJavaScript', args: [dshThemeScript(isDark)] }])
        .then((res) => {
          if (!isApiOk(res)) console.error('[dsh] apply theme to webview failed:', res)
        })
        .catch((err) => console.error('[dsh] apply theme to webview failed:', err))
    },
    [api],
  )

  // 主题由 setting 插件经主进程广播（theme 通道，REPLAY 回放初始值；system 已解析为 dark/light）
  const darkRef = useRef(false)
  useEffect(() => {
    if (!viewId) return
    const off = window.dlient.on('theme', (theme) => {
      darkRef.current = theme === 'dark'
      void applyThemeToWebview(viewId, darkRef.current)
    })
    return off
  }, [viewId, applyThemeToWebview])

  const handleViewReady = useCallback((id: string) => setViewId(id), [])

  // 页面加载完成后 body 一定就绪，再应用一次（覆盖初始注入时页面尚未加载的情况）
  const handleDidFinishLoad = useCallback(() => {
    if (viewId) void applyThemeToWebview(viewId, darkRef.current)
  }, [viewId, applyThemeToWebview])

  // 订阅 worker 推送的状态
  useEffect(() => {
    return api.onEvent('dsh.status', (data) => {
      if (data && typeof data === 'object' && 'phase' in (data as object)) {
        setStatus(data as DshStatus)
      }
    })
  }, [api])

  const start = () => {
    if (startingRef.current) return
    startingRef.current = true
    setStatus({ phase: 'starting' })
    void api
      .request<{ ok: boolean; url?: string; error?: string }>('dsh.start')
      .then((res) => {
        const d = res?.data
        if (isApiOk(res) && d?.ok && d.url) setStatus({ phase: 'ready', url: d.url })
        else
          setStatus({
            phase: 'error',
            error:
              d?.error ?? resolveApiMsg(res?.msg, locale) ?? defaultApiErrorMsg(res?.code, locale) ?? t(`${NS}.startFailed`),
          })
      })
      .catch((err) => setStatus({ phase: 'error', error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        startingRef.current = false
      })
  }

  // 挂载时：查 worker 当前状态 —— 若已停止过（startedOnce）则不自动重启，显示「已停止」；
  // 首次打开（idle 且未启动过）自动启动 dsh web 服务；
  // 查询超时（3s）/ 失败时兜底直接启动（与旧行为一致，避免「无反应」）
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!cancelled) start()
    }, 3000)
    void api
      .request<DshStatus>('dsh.status')
      .then((s) => {
        if (cancelled) return
        window.clearTimeout(timer)
        const d = s?.data
        if (isApiOk(s) && d?.phase === 'idle' && d.startedOnce) return
        start()
      })
      .catch(() => {
        if (cancelled) return
        window.clearTimeout(timer)
        start()
      })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="dsh-root">
      {status.phase === 'ready' && status.url ? (
        <div className="dsh-body">
          <Webview
            src={status.url}
            onViewReady={handleViewReady}
            onDidFinishLoad={handleDidFinishLoad}
          />
        </div>
      ) : (
        <div className="dsh-empty">
          {status.phase === 'error' ? (
            <Empty
              title={t(`${NS}.error`)}
              description={status.error}
              action={
                <Button variant="default" onClick={start}>
                  <Icon name="refresh" />
                  {t(`${NS}.retry`)}
                </Button>
              }
            />
          ) : status.phase === 'idle' ? (
            <Empty
              title={t(`${NS}.statusIdle`)}
              description={t(`${NS}.idleHint`)}
              action={
                <Button variant="default" onClick={start}>
                  <Icon name="refresh" />
                  {t(`${NS}.retry`)}
                </Button>
              }
            />
          ) : (
            <>
              <Loading loading text={statusText(status, t)} />
              <p className="dsh-empty-sub">{phaseHint(status.phase, t)}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 状态栏文案（随 phase 变化） */
function statusText(s: DshStatus, t: (key: string) => string): string {
  switch (s.phase) {
    case 'ready': return t(`${NS}.statusReady`)
    case 'checking-node': return t(`${NS}.statusNode`)
    case 'installing-dsh': return t(`${NS}.statusInstall`)
    case 'starting': return t(`${NS}.statusStarting`)
    case 'error': return t(`${NS}.statusError`)
    default: return t(`${NS}.statusIdle`)
  }
}

/** 空态提示（启动中的阶段说明） */
function phaseHint(phase: string, t: (key: string) => string): string {
  if (phase === 'installing-dsh') return t(`${NS}.hintInstall`)
  if (phase === 'checking-node') return t(`${NS}.hintNode`)
  return t(`${NS}.hintStarting`)
}
