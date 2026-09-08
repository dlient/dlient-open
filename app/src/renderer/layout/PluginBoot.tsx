/**
 * PluginBoot：插件启动页（内容区页面级组件，内置宿主壳）。
 *
 * 流程：
 *  1. loading：全屏居中 loading，随后经 hostShell.checkReadiness 检测插件所需依赖与 nodejs
 *     （BFS 依赖闭包：自身 + 全部依赖）；
 *  2. 依赖未安装 / nodejs 不符合要求 → 显示安装页；否则直接进入第 3 步；
 *  3. 安装完成（重新检测就绪）后以 PluginView 引入插件。
 *
 * 开源版无插件市场：缺失依赖不可自动安装（需用户先导入对应插件），页面仅提供 Node.js 安装；
 * 仍不就绪时展示错误提示。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, CheckCircleFilledIcon, LoadingIcon, MessagePlugin, PluginView, TimeIcon } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import './i18n'

const NS = 'plugin-layout'

/** 未就绪状态（hostShell.checkReadiness 返回） */
export interface UnreadyStatus {
  ready: boolean
  /** 闭包中未安装的依赖（无市场可自动安装） */
  missingDeps: string[]
  /** 需要 nodejs 但未安装运行环境 */
  nodejsMissing: boolean
  /** 需要 nodejs 且版本不满足（需更新） */
  nodejsOutdated: boolean
  /** 闭包中声明的最高 node 版本要求 */
  nodeVersion?: string
}

type BootPhase = 'checking' | 'unready' | 'ready' | 'error'
type InstallRowState = 'pending' | 'installing' | 'done'

/** 插件本地化名称（manifest 多语言优先，其次 name，最后 id） */
export function pluginName(p: InstalledPluginInfo | undefined, locale: string): string {
  if (!p) return ''
  return resolveLocalized(p.nameL10n ?? p.name, locale) || p.name
}

/** 多语言文本解析：对象 / JSON 字符串 → 按 locale（default 兜底）；普通字符串原样返回 */
export function resolveLocalized(text: unknown, locale: string): string {
  if (text == null) return ''
  if (typeof text === 'string') {
    const trimmed = text.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed)
        if (obj && typeof obj === 'object') {
          return obj[locale] ?? obj['default'] ?? ''
        }
      } catch {
        /* 不是 JSON，按普通字符串处理 */
      }
    }
    return text
  }
  if (typeof text === 'object') {
    const obj = text as Record<string, unknown>
    const v = obj[locale] ?? obj['default']
    return typeof v === 'string' ? v : ''
  }
  return String(text)
}

/** 安装行左侧状态图标：pending 时钟 / installing 旋转 loading / done 对号 */
function BootStateIcon({ state }: { state: InstallRowState }) {
  if (state === 'installing') {
    return (
      <span className="_layout-bot-step-icon _layout-bot-step-icon--installing">
        <LoadingIcon />
      </span>
    )
  }
  if (state === 'done') {
    return (
      <span className="_layout-bot-step-icon _layout-bot-step-icon--done">
        <CheckCircleFilledIcon />
      </span>
    )
  }
  return (
    <span className="_layout-bot-step-icon _layout-bot-step-icon--pending">
      <TimeIcon />
    </span>
  )
}

/** 目标插件 manifest 摘要（传入时根节点按 manifest 分析依赖闭包与 nodejs 要求） */
export interface PluginBootManifest {
  /** 依赖插件 id 列表（manifest dlient.dependencies 的键：对象或数组） */
  dependencies?: string[] | Record<string, unknown>
  /** 最低要求的 Node.js 版本（如 "22"） */
  nodeVersion?: string
}

export interface PluginBootProps {
  /** 目标插件 id */
  pluginId: string
  /** dev 插件 manifest（dev 预览传入）：根节点按此分析 */
  manifest?: PluginBootManifest
  /** 就绪回调。提供时就绪后调用 success 且不再渲染 PluginView；不提供时内部渲染 <PluginView pluginId /> */
  success?: () => void
}

/**
 * PluginBoot：插件启动页。默认 loading → 检测就绪 → 未就绪显示安装页（nodejs + 缺失依赖提示）
 * → 安装完成重新检测就绪 → 以 PluginView 引入插件（或回调 success 交由调用方接管）。
 */
export function PluginBoot({ pluginId, manifest, success }: PluginBootProps) {
  const { t, locale } = useI18n()
  const [phase, setPhase] = useState<BootPhase>('checking')
  const [status, setStatus] = useState<UnreadyStatus | null>(null)
  const [deps, setDeps] = useState<InstalledPluginInfo[]>([])
  const [needNodejs, setNeedNodejs] = useState(false)
  const [states, setStates] = useState<Record<string, InstallRowState>>({})
  const [errorMsg, setErrorMsg] = useState('')
  const [running, setRunning] = useState(false)
  const alive = useRef(true)
  const successFired = useRef(false)
  const successRef = useRef(success)
  successRef.current = success
  const manifestRef = useRef(manifest)
  manifestRef.current = manifest
  const localeRef = useRef(locale)
  localeRef.current = locale

  const setRow = (key: string, v: InstallRowState) => setStates((prev) => ({ ...prev, [key]: v }))

  const fireSuccess = useCallback(() => {
    if (successRef.current && !successFired.current) {
      successFired.current = true
      successRef.current()
    }
  }, [])

  /** 检测就绪：就绪 → ready；未就绪 → 拉取已安装清单解析依赖来源并进入安装页 */
  const runCheck = useCallback(async () => {
    setPhase('checking')
    try {
      const s = await window.dlient.hostShell.checkReadiness(pluginId, manifestRef.current ?? undefined)
      if (!alive.current) return
      if (!s || s.ready) {
        setPhase('ready')
        fireSuccess()
        return
      }
      let installedList: InstalledPluginInfo[] = []
      try {
        installedList = await window.dlient.hostShell.listPlugins()
      } catch {
        /* 拉取失败时依赖按未知来源展示 */
      }
      if (!alive.current) return
      setStatus(s)
      setDeps(installedList)
      setNeedNodejs(s.nodejsMissing || s.nodejsOutdated)
      setStates(() => {
        const st: Record<string, InstallRowState> = {}
        if (s.nodejsMissing || s.nodejsOutdated) st.nodejs = 'pending'
        for (const d of s.missingDeps) st[d] = 'pending'
        return st
      })
      setErrorMsg('')
      setPhase('unready')
    } catch (err) {
      console.error('[layout] PluginBoot check failed:', err)
      if (!alive.current) return
      setErrorMsg(String(err instanceof Error ? err.message : err))
      setPhase('error')
    }
  }, [pluginId, fireSuccess])

  useEffect(() => {
    alive.current = true
    void runCheck()
    return () => {
      alive.current = false
    }
  }, [runCheck])

  /** 安装：Node.js（未装 / 版本不符 → 安装；装后重新校验）；缺失依赖无法自动安装（无市场），仅提示 */
  const runInstall = async () => {
    if (running || !status) return
    setRunning(true)
    try {
      if (needNodejs) {
        setRow('nodejs', 'installing')
        const ins = await window.dlient.hostShell.nodejsInstall(status.nodeVersion)
        if (!ins?.ok) throw new Error(ins?.error ?? String(t(`${NS}.nodejsInstallFailed`)))
        setRow('nodejs', 'done')
        const ver = status.nodeVersion
        const st = await window.dlient.hostShell.nodejsStatus(ver ? { version: ver } : undefined)
        if (!st.satisfies) {
          if (alive.current) {
            setErrorMsg(String(t(`${NS}.bootEnvError`)))
            setPhase('error')
          }
          return
        }
      }
      const re = await window.dlient.hostShell.checkReadiness(pluginId, manifestRef.current ?? undefined)
      if (!alive.current) return
      if (!re || re.ready) {
        setPhase('ready')
        fireSuccess()
      } else {
        setErrorMsg(String(t(`${NS}.bootEnvError`)))
        setPhase('error')
      }
    } catch (err) {
      console.error('[layout] PluginBoot install failed:', err)
      MessagePlugin.error(String(err instanceof Error ? err.message : err))
    } finally {
      if (alive.current) setRunning(false)
    }
  }

  // 1) checking：居中 loading
  if (phase === 'checking') {
    return (
      <div className="_layout-bot">
        <div className="_layout-bot-card _layout-bot-card--loading">
          <LoadingIcon />
        </div>
      </div>
    )
  }

  // 2) error：运行环境无法满足
  if (phase === 'error') {
    return (
      <div className="_layout-bot">
        <div className="_layout-bot-card">
          <div className="_layout-bot-head">
            <div className="_layout-bot-title">{t(`${NS}.unreadyTitle`)}</div>
            <div className="_layout-bot-sub">{errorMsg}</div>
          </div>
          <Button variant="default" className="dui:w-full" onClick={() => void runCheck()}>
            {t(`${NS}.bootRetry`)}
          </Button>
        </div>
      </div>
    )
  }

  // 3) unready：安装页（nodejs 步骤 + 缺失依赖提示 + 全宽「安装运行环境」按钮）
  if (phase === 'unready' && status) {
    const missingInstalled = status.missingDeps.filter((id) => deps.some((p) => p.id === id))
    const missingUnknown = status.missingDeps.filter((id) => !deps.some((p) => p.id === id))
    return (
      <div className="_layout-bot">
        <div className="_layout-bot-card">
          <div className="_layout-bot-head">
            <div className="_layout-bot-title">{t(`${NS}.unreadyTitle`)}</div>
            <div className="_layout-bot-sub">{t(`${NS}.bootInstallHint`)}</div>
          </div>
          <div className="_layout-bot-steps">
            {needNodejs && (
              <div className={`_layout-bot-step ${states.nodejs === 'installing' ? '_layout-bot-step--installing' : ''}`}>
                <BootStateIcon state={states.nodejs ?? 'pending'} />
                <div className="_layout-bot-step-body">
                  <span className="_layout-bot-step-title">{t(`${NS}.nodejsTitle`)}</span>
                  <span className="_layout-bot-step-desc">
                    {status.nodejsMissing ? t(`${NS}.unreadyNodeMissing`) : t(`${NS}.unreadyNodeOutdated`)}
                  </span>
                </div>
              </div>
            )}
            {missingInstalled.map((id) => (
              <div key={id} className="_layout-bot-step">
                <BootStateIcon state={states[id] ?? 'pending'} />
                <div className="_layout-bot-step-body">
                  <span className="_layout-bot-step-title">{pluginName(deps.find((p) => p.id === id), localeRef.current) || id}</span>
                  <span className="_layout-bot-step-desc">{t(`${NS}.unknownSource`)}</span>
                </div>
              </div>
            ))}
            {missingUnknown.map((id) => (
              <div key={id} className="_layout-bot-step">
                <BootStateIcon state={states[id] ?? 'pending'} />
                <div className="_layout-bot-step-body">
                  <span className="_layout-bot-step-title">{id}</span>
                  <span className="_layout-bot-step-desc">{t(`${NS}.unknownSource`)}</span>
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="default"
            className="dui:w-full"
            disabled={running || missingUnknown.length > 0}
            onClick={() => void runInstall()}
          >
            {running ? t(`${NS}.unreadyInstallingAll`) : t(`${NS}.unreadyInstallAndOpen`)}
          </Button>
        </div>
      </div>
    )
  }

  // 4) ready：默认以 PluginView 引入插件；success 模式下交由调用方接管
  if (success) return null
  return <PluginView pluginId={pluginId} />
}

export default PluginBoot
