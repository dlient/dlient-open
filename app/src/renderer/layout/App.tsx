/**
 * 内置操作台主界面（src/renderer/layout/App.tsx，开源版并入宿主）。
 *
 * 结构（@dlient-open/ui 组件体系，样式走 tokens.css 的 --dlient-* 语义变量）：
 *   - 标题栏：logo 品牌 + 面包屑；右侧窗口操作（mask 渲染，hostShell.window*）
 *   - 活动栏（侧边导航）：
 *       · 第一个：操作台（layout 自有页；页头右上提供「导入插件」）
 *       · 中间：已打开的应用插件（点击切换；keep-alive 不销毁页面）
 *       · 底部：设置（内置页）
 *   - 内容区：所有已打开的页面常驻渲染，用 display 控制显隐（切换不销毁）
 *
 * 导入 .dlient 插件入口位于操作台（console）页右上，活动栏不再放置 ＋ 号按钮。
 *
 * 开源版无 auth / 无插件市场 / 无 dev-tools：首方数据经 window.dlient.hostShell 获取；
 * 插件清单来自宿主已安装注册表（~/.dlient-open/plugins 目录扫描）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Button, Empty, MessagePlugin, PluginIcon, modal } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import PluginBoot, { resolveLocalized, pluginName } from './PluginBoot'
import SettingPage from '../setting/SettingPage'
// 样式经标准 CSS 管线构建为独立文件，由入口引用。
import './styles.css'
import './i18n'
// 底部固定入口图标（内联 SVG，fill=currentColor 随选中态变色）
import { SettingRailIcon } from './fixed-icons'
// 内置 layout 资源（vite 打包为 URL）
import logoUrl from '../assets/layout/logo.svg'
import iconUrl from '../assets/layout/icon.svg'
import moreUrl from '../assets/layout/more.svg'
import icChromeClose from '../assets/layout/ic_chrome_close.svg'
import icChromeMaximize from '../assets/layout/ic_chrome_maximize.svg'
import icChromeMinimize from '../assets/layout/ic_chrome_minimize.svg'
import icChromeUnmaximize from '../assets/layout/ic_chrome_unmaximize.svg'

const CONSOLE = 'console'
const SETTING = 'plugin-setting'
const RECENT_KEY = 'layout-recent'
/** 固定到活动栏的插件 id（启动后即显示图标，但内容区不预加载页面） */
const PINNED_KEY = 'layout-pinned'
const NS = 'plugin-layout'
/** 活动栏按钮固定高 32px、间距 6px（与 styles.css 保持一致，用于溢出折叠计算） */
const RAIL_BTN_H = 32
const RAIL_BTN_GAP = 6

/** 窗口控制图标：SVG 经 mask 渲染，颜色跟随 currentColor（亮/暗主题自适应） */
function WinIcon({ src }: { src: string }) {
  return (
    <span
      className="dl-winbtn-icon"
      style={{
        maskImage: `url("${src}")`,
        WebkitMaskImage: `url("${src}")`,
      }}
    />
  )
}

/** 是否有 UI（可被 PluginView 打开） */
function hasUi(p: InstalledPluginInfo): boolean {
  return p.type !== 'worker'
}

/** 应用卡片：名称 + 下方版本号 + 描述，点击打开；依赖缺失显示未就绪标识 */
function AppCard({
  plugin,
  unready,
  onOpen,
}: {
  plugin: InstalledPluginInfo
  isOpen: boolean
  unready?: boolean
  onOpen: (id: string) => void
}) {
  const { t, locale } = useI18n()
  const name = resolveLocalized(plugin.nameL10n ?? plugin.name, locale)
  const description = resolveLocalized(plugin.descriptionL10n ?? plugin.description, locale)
  return (
    <article className={`dl-card ${unready ? 'dl-card-unready' : 'dl-card-click'}`} onClick={() => onOpen(plugin.id)}>
      <div className="dl-card-head">
        <PluginIcon pluginId={plugin.id} icon={plugin.icon} name={name} size={36} className="dl-card-icon" />
        <div className="dl-card-meta">
          <div className="dl-card-name-row">
            <span className="dl-card-name">{name}</span>
            {unready && <span className="dl-unready-badge">{t(`${NS}.unready`)}</span>}
          </div>
          <span className="dl-card-version">v{plugin.version}</span>
        </div>
      </div>
      {description && <div className="dl-card-desc">{description}</div>}
    </article>
  )
}

type ImportReviewPerm = { key: string; level: string; description?: { 'zh-CN': string; 'en-US': string } | null }
type ImportReviewDep = { id: string; source: string; kind: 'npm' | 'github' | 'url' }

/**
 * 导入确认弹框正文：插件名/版本/描述 + 「权限 / 依赖」两个 tab。
 * - 权限：key（风险色点）+ 说明，两行一条
 * - 依赖（manifest preInstall）：插件 id + 配置内容，两行一条；npm / github 行点击在浏览器打开对应页面查看
 */
function ImportReviewBody({
  preview,
}: {
  preview: {
    name: string
    version: string
    description?: string
    permissions: ImportReviewPerm[]
    preInstall?: ImportReviewDep[]
  }
}) {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<'perms' | 'deps'>('perms')
  const loc = locale === 'en-US' ? 'en-US' : 'zh-CN'
  const deps = preview.preInstall ?? []

  const openDep = (dep: ImportReviewDep) => {
    const url = dep.kind === 'npm' ? `https://www.npmjs.com/package/${encodeURIComponent(dep.id)}` : dep.source
    void window.dlient.hostShell.openExternal(url).catch(() => undefined)
  }

  return (
    <div className="dl-import-review">
      <p className="dl-import-review-meta">
        {preview.name} · v{preview.version}
      </p>
      {preview.description && <p className="dl-import-review-desc">{preview.description}</p>}

      <div className="dl-import-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'perms'}
          className={`dl-import-tab ${tab === 'perms' ? 'active' : ''}`}
          onClick={() => setTab('perms')}
        >
          {t(`${NS}.importTabPerms`)}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'deps'}
          className={`dl-import-tab ${tab === 'deps' ? 'active' : ''}`}
          onClick={() => setTab('deps')}
        >
          {t(`${NS}.importTabDeps`)}
        </button>
      </div>

      {tab === 'perms' ? (
        preview.permissions.length === 0 ? (
          <p className="dl-import-review-empty">{t(`${NS}.importNoPerms`)}</p>
        ) : (
          <ul className="dl-import-perms">
            {preview.permissions.map((it) => {
              const risk = it.level === 'dangerous' ? 'dangerous' : it.level === 'warn' ? 'warn' : 'default'
              return (
                <li key={it.key} className={`dl-import-perm dl-import-perm--${risk}`}>
                  <span className="dl-import-perm-head">
                    <span className={`dl-import-risk-dot dl-import-risk-dot--${risk}`} />
                    <code className="dl-import-perm-key">{it.key}</code>
                  </span>
                  <span className="dl-import-perm-desc">{it.description ? it.description[loc] ?? it.key : it.key}</span>
                </li>
              )
            })}
          </ul>
        )
      ) : deps.length === 0 ? (
        <p className="dl-import-review-empty">{t(`${NS}.importNoDeps`)}</p>
      ) : (
        <ul className="dl-import-deps">
          {deps.map((dep) => {
            const clickable = dep.kind === 'npm' || dep.kind === 'github'
            return (
              <li
                key={dep.id}
                className={`dl-import-dep ${clickable ? 'dl-import-dep--link' : ''}`}
                title={clickable ? String(t(`${NS}.importDepViewHint`)) : undefined}
                onClick={clickable ? () => openDep(dep) : undefined}
              >
                <span className="dl-import-dep-name">{dep.id}</span>
                <span className="dl-import-dep-src">{dep.source}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** 操作台（layout 自有页）：最近打开 + 已安装应用；两者皆空显示空状态 */
function ConsolePage({
  recentApps,
  installedApps,
  opened,
  unready,
  onOpen,
}: {
  recentApps: InstalledPluginInfo[]
  installedApps: InstalledPluginInfo[]
  opened: string[]
  unready: (id: string) => boolean
  onOpen: (id: string) => void
}) {
  const { t } = useI18n()
  const isEmpty = recentApps.length === 0 && installedApps.length === 0

  if (isEmpty) {
    return (
      <div className="dl-empty-wrap">
        <Empty
          title={String(t(`${NS}.emptyTitle`))}
          description={String(t(`${NS}.emptySub`))}
          action={
            <Button variant="default" onClick={() => onOpen('__import__')}>
              {t(`${NS}.openMarket`)}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="dl-page-pad">
      <div className="dl-console-header">
        <div className="dl-console-title-block">
          <h1 className="dl-console-title">{t(`${NS}.console`)}</h1>
          <p className="dl-console-sub">{t(`${NS}.consoleSub`)}</p>
        </div>
        <Button variant="default" onClick={() => onOpen('__import__')}>
          {t(`${NS}.importTitle`)}
        </Button>
      </div>

      {recentApps.length > 0 && (
        <section className="dl-section">
          <div className="dl-section-head">
            <h2 className="dl-section-title">{t(`${NS}.recentTitle`)}</h2>
            <span className="dl-section-count">{t(`${NS}.count`, { count: recentApps.length })}</span>
          </div>
          <div className="dl-grid">
            {recentApps.map((p) => (
              <AppCard key={p.id} plugin={p} isOpen={opened.includes(p.id)} unready={unready(p.id)} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}

      {installedApps.length > 0 && (
        <section className="dl-section">
          <div className="dl-section-head">
            <h2 className="dl-section-title">{t(`${NS}.installedTitle`)}</h2>
            <span className="dl-section-count">{t(`${NS}.count`, { count: installedApps.length })}</span>
          </div>
          <div className="dl-grid">
            {installedApps.map((p) => (
              <AppCard key={p.id} plugin={p} isOpen={opened.includes(p.id)} unready={unready(p.id)} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// 具名导出供跨插件引入（dev 预览兼容）
export { PluginBoot } from './PluginBoot'

/** 窗口最大化状态：初始经 hostShell 查询，随后监听主进程广播 */
function useWindowState() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void window.dlient.hostShell
      .windowIsMaximized()
      .then((m) => setMaximized(m))
      .catch((err) => console.error('[layout] isMaximized failed:', err))
    const off = window.dlient.on('window-state', ({ maximized: m }) => setMaximized(m))
    return off
  }, [])
  return maximized
}

export default function App() {
  const { t, locale } = useI18n()
  const maximized = useWindowState()

  const [plugins, setPlugins] = useState<InstalledPluginInfo[]>([])
  // keep-alive：已打开页面（常驻渲染，display 控制显隐）
  const [opened, setOpened] = useState<string[]>([CONSOLE])
  const [active, setActive] = useState<string>(CONSOLE)
  // 打开历史（localStorage 记录，最近在前）
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
      return Array.isArray(raw) ? (raw as string[]) : []
    } catch {
      return []
    }
  })
  // 固定到活动栏的插件（localStorage 持久化；仅显示图标，不加入 opened）
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') as unknown
      return Array.isArray(raw) ? (raw as string[]) : []
    } catch {
      return []
    }
  })

  /** 插件安装确认框忙碌守卫（plugin.install 用户授权；同时只允许一个） */
  const piConfirmBusy = useRef(false)

  /** 拉取插件清单（首方通道：宿主已安装注册表 + 目录扫描） */
  const reloadPlugins = useCallback(() => {
    void window.dlient.hostShell
      .listPlugins()
      .then((list) => setPlugins(Array.isArray(list) ? list : []))
      .catch((err) => console.error('[layout] listPlugins failed:', err))
  }, [])

  useEffect(() => {
    reloadPlugins()
  }, [reloadPlugins])

  // 插件集合变化（导入 / 卸载 / dev 变更广播）→ 刷新清单
  useEffect(() => {
    const off = window.dlient.on('plugin-changed', () => {
      reloadPlugins()
    })
    return off
  }, [reloadPlugins])

  // 最近打开 / 已安装应用（本地计算；排除操作台 / 设置内置页 / 无 UI 插件）
  const pluginMap = useMemo(() => new Map(plugins.map((p) => [p.id, p])), [plugins])
  const recentApps = useMemo(
    () => recent.map((id) => pluginMap.get(id)).filter((p): p is InstalledPluginInfo => !!p && hasUi(p)).slice(0, 3),
    [recent, pluginMap],
  )
  const installedApps = useMemo(
    () =>
      plugins.filter(
        (p) => hasUi(p) && !p.system && p.id !== CONSOLE && p.id !== SETTING && !recent.includes(p.id) && p.source !== 'dev',
      ),
    [plugins, recent],
  )

  /** 依赖检查：id → 未安装的依赖插件 id 列表（存在缺失 = 未就绪） */
  const unready = useMemo(() => {
    const ids = new Set(plugins.map((p) => p.id))
    const map = new Map<string, string[]>()
    for (const p of plugins) {
      // 'nodejs' 为运行时占位（开源版并入宿主、非插件），就绪与否由 checkReadiness/nodeVersion 单独判定
      const missing = (p.dependencies ?? []).filter((d) => d !== 'nodejs' && !ids.has(d))
      if (missing.length > 0) map.set(p.id, missing)
    }
    return map
  }, [plugins])

  /** 打开插件（首次加入 opened，之后仅切换 active；页面不销毁；记录最近打开） */
  const openPlugin = useCallback((id: string) => {
    setOpened((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setActive(id)
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)]
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  /** 「插件未打包」提示：提示先打包，不打开空白页 */
  const showNotPackaged = useCallback(
    (name: string) => {
      modal.info({
        title: t(`${NS}.notPackagedTitle`),
        description: t(`${NS}.notPackagedMsg`, { name }),
        confirmBtn: t(`${NS}.gotIt`),
      })
    },
    [t],
  )

  /** 统一打开入口（所有打开路径共用）：已打开 → 仅切换；未打包 → 提示；否则直接打开 */
  const openRequest = useCallback(
    async (id: string) => {
      if (id === '__import__') {
        await handleImport()
        return
      }
      if (id === SETTING) {
        if (!opened.includes(id)) setOpened((prev) => [...prev, id])
        setActive(id)
        return
      }
      if (opened.includes(id)) {
        setActive(id)
        return
      }
      const target = pluginMap.get(id)
      if (target && target.hasDist === false) {
        showNotPackaged(pluginName(target, locale) || id)
        return
      }
      // 打开前完整性预检（本地签名）：验签失败（文件被改/损坏）→ 友好提示，引导重新安装
      if (target && target.source !== 'dev' && !opened.includes(id)) {
        const v = await window.dlient.hostShell.verifyPlugin(id).catch(() => ({ ok: true }))
        if (!v.ok) {
          const name = pluginName(target, locale) || id
          void modal.confirm({
            title: t(`${NS}.piCorruptTitle`),
            description: String(t(`${NS}.piCorruptMsg`, { name })),
            confirmBtn: t(`${NS}.piReinstall`),
            cancelBtn: t(`${NS}.gotIt`),
            onConfirm: () => {
              void handleImport()
            },
          })
          return
        }
      }
      openPlugin(id)
    },
    [opened, pluginMap, locale, t, openPlugin, showNotPackaged],
  )

  /** 固定 / 取消固定到活动栏 */
  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      localStorage.setItem(PINNED_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  /** 关闭应用：从 opened 移除；关的是当前页则回退到相邻页，无相邻页回操作台 */
  const closeApp = useCallback(
    (id: string) => {
      if (id === CONSOLE || !opened.includes(id)) return
      const idx = opened.indexOf(id)
      const next = opened.filter((x) => x !== id)
      setOpened(next)
      if (active === id) setActive(next[Math.min(idx, next.length - 1)] ?? CONSOLE)
    },
    [opened, active],
  )

  /** 卸载插件（右键菜单） */
  const uninstallApp = useCallback(
    async (id: string) => {
      const p = pluginMap.get(id)
      const name = p ? pluginName(p, locale) || id : id
      const ok = await modal.sync.confirm(t(`${NS}.uninstallTitle`), t(`${NS}.uninstallConfirm`, { name }))
      if (!ok) return
      const res = await window.dlient.hostShell.uninstallPlugin(id).catch(() => ({ ok: false, error: 'uninstall failed' }))
      if (res?.ok) {
        MessagePlugin.success(String(t(`${NS}.uninstallDone`, { name })))
        closeApp(id)
        reloadPlugins()
      } else {
        MessagePlugin.error(res?.error ?? 'uninstall failed')
      }
    },
    [pluginMap, locale, t, closeApp, reloadPlugins],
  )

  /** 活动栏图标右键：经 hostShell.menuPopup 弹系统原生菜单，返回被点击项 id 后执行 */
  const onRailContextMenu = useCallback(
    (e: ReactMouseEvent, id: string) => {
      e.preventDefault()
      const isPinned = pinned.includes(id)
      const isOpened = opened.includes(id)
      void window.dlient.hostShell
        .menuPopup({
          items: [
            { id: 'pin', label: isPinned ? t(`${NS}.unpinFromRail`) : t(`${NS}.pinToRail`) },
            { id: 'toggle', label: isOpened ? t(`${NS}.closeApp`) : t(`${NS}.openApp`) },
            { id: 'uninstall', label: t(`${NS}.uninstallTitle`) },
          ],
        })
        .then((picked) => {
          if (picked === 'pin') togglePin(id)
          else if (picked === 'toggle') {
            if (isOpened) closeApp(id)
            else void openRequest(id)
          } else if (picked === 'uninstall') void uninstallApp(id)
        })
        .catch((err) => console.error('[layout] menu.popup failed:', err))
    },
    [t, pinned, opened, togglePin, closeApp, openRequest, uninstallApp],
  )

  /** 执行导入安装（preview 权限确认后）；成功/失败均提示并返回是否成功 */
  const runImportInstall = useCallback(
    async (filePath: string): Promise<boolean> => {
      const res = await window.dlient.hostShell
        .confirmImportPlugin(filePath)
        .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
      if (res.ok) {
        MessagePlugin.success(String(t(`${NS}.importDone`, { name: res.name ?? res.id ?? '' })))
        reloadPlugins()
        if (res.id) void openRequest(res.id)
        return true
      }
      MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: res.error ?? '' })))
      return false
    },
    [t, reloadPlugins, openRequest],
  )

  /** 导入 .dlient 插件：选文件 → 解析并弹「权限确认」框 → 确认后安装 */
  const handleImport = useCallback(async () => {
    let res: Awaited<ReturnType<typeof window.dlient.hostShell.previewImportPlugin>>
    try {
      res = await window.dlient.hostShell.previewImportPlugin()
    } catch (err) {
      MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: err instanceof Error ? err.message : String(err) })))
      return
    }
    if (!res) return // 取消文件选择
    if (!res.ok || !res.preview) {
      MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: res.error ?? '' })))
      return
    }
    const preview = res.preview
    void modal.confirm({
      title: t(`${NS}.importReviewTitle`, { name: preview.name, version: preview.version }),
      description: <ImportReviewBody preview={preview} />,
      width: 460,
      confirmBtn: t(`${NS}.importConfirm`),
      cancelBtn: t(`${NS}.importCancel`),
      onConfirm: async (ctx) => {
        const ok = await runImportInstall(preview.filePath)
        if (ok) ctx.close()
        return ok
      },
    })
  }, [t, runImportInstall])

  /** 监听宿主「plugin.install 用户确认」：弹授权框（复用导入确认弹框样式），结果回传主进程 */
  useEffect(() => {
    const off = window.dlient.hostShell.onPluginInstallConfirm((data) => {
      const confirmId = data?.confirmId
      const p = data?.payload
      if (!confirmId || !p) return
      if (piConfirmBusy.current) {
        void window.dlient.hostShell.confirmPluginInstall(confirmId, false)
        return
      }
      piConfirmBusy.current = true
      let responded = false
      const settle = (ok: boolean) => {
        if (responded) return
        responded = true
        piConfirmBusy.current = false
        void window.dlient.hostShell.confirmPluginInstall(confirmId, ok)
      }
      void modal.confirm({
        title: t(`${NS}.piConfirmTitle`, { id: p.id }),
        description: (
          <div className="dl-install-confirm">
            {p.description && <p className="dl-import-review-desc">{p.description}</p>}
            <ul className="dl-import-deps">
              <li className="dl-import-dep">
                <span className="dl-import-dep-name">{t(`${NS}.piKindLabel`)}</span>
                <span className="dl-import-dep-src">{t(`${NS}.piKind_${p.kind}`)}</span>
              </li>
              <li className="dl-import-dep">
                <span className="dl-import-dep-name">{t(`${NS}.piSourceLabel`)}</span>
                <span className="dl-import-dep-src">{p.source}</span>
              </li>
            </ul>
          </div>
        ),
        width: 460,
        confirmBtn: t(`${NS}.importConfirm`),
        cancelBtn: t(`${NS}.importCancel`),
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
        onClose: () => settle(false),
      })
    })
    return off
  }, [t])

  // 内容区活动应用（activePlugin 归属）：切换时同步宿主 webview 可见性归属
  useEffect(() => {
    void window.dlient.hostShell
      .setActiveApp(active === CONSOLE || active === SETTING ? null : active)
      .catch((err) => console.error('[layout] setActiveApp failed:', err))
  }, [active])

  // 活动栏中间：已打开的应用（除操作台外）+ 已固定的插件（排除底部设置入口）
  const openedApps = opened.filter((id) => id !== CONSOLE && id !== SETTING)

  const railApps = useMemo(() => {
    const list = openedApps.slice()
    for (const id of pinned) {
      if (id !== CONSOLE && id !== SETTING && !list.includes(id) && pluginMap.has(id)) list.push(id)
    }
    return list
  }, [openedApps, pinned, pluginMap])

  // 活动栏中间应用区高度测量：放不下时折叠进「···」按钮
  const [railAppsH, setRailAppsH] = useState(0)
  const railObsRef = useRef<ResizeObserver | null>(null)
  const railAppsRef = useCallback((el: HTMLDivElement | null) => {
    railObsRef.current?.disconnect()
    railObsRef.current = null
    if (!el) return
    const update = () => setRailAppsH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    railObsRef.current = ro
    ro.observe(el)
  }, [])
  const railMaxVisible = railAppsH > 0 ? Math.floor((railAppsH + RAIL_BTN_GAP) / (RAIL_BTN_H + RAIL_BTN_GAP)) : railApps.length
  const railOverflow = railApps.length > railMaxVisible
  const railVisibleApps = railOverflow ? railApps.slice(0, Math.max(0, railMaxVisible - 1)) : railApps
  const railHiddenApps = railOverflow ? railApps.slice(railVisibleApps.length) : []
  const railHiddenActive = railHiddenApps.includes(active)

  const winControl = (method: 'minimize' | 'maximize' | 'unmaximize' | 'close') => {
    const map = { minimize: 'windowMinimize', maximize: 'windowMaximize', unmaximize: 'windowUnmaximize', close: 'windowClose' } as const
    void window.dlient.hostShell[map[method]]().catch((err) => console.error('[layout] window', method, err))
  }

  // 「···」更多应用浮层
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState<{ x: number; y: number } | null>(null)
  const moreBtnRef = useRef<HTMLButtonElement | null>(null)
  const moreTimerRef = useRef<number | undefined>(undefined)
  const openMore = useCallback(() => {
    if (moreTimerRef.current !== undefined) {
      window.clearTimeout(moreTimerRef.current)
      moreTimerRef.current = undefined
    }
    const el = moreBtnRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setMorePos({ x: r.right + 8, y: r.top })
    }
    setMoreOpen(true)
  }, [])
  const closeMore = useCallback(() => {
    if (moreTimerRef.current !== undefined) window.clearTimeout(moreTimerRef.current)
    moreTimerRef.current = window.setTimeout(() => setMoreOpen(false), 180)
  }, [])
  useEffect(() => {
    return () => {
      if (moreTimerRef.current !== undefined) window.clearTimeout(moreTimerRef.current)
    }
  }, [])

  return (
    <div className="dl-root">
      {/* ===== 标题栏 ===== */}
      <header className="dl-titlebar">
        <div className="dl-titlebar-left">
          <img src={logoUrl} alt="dlient" className="dl-logo-img" />
          <span className="dl-title">Dlient</span>
          <span className="dl-crumb">| {active === CONSOLE ? t(`${NS}.console`) : pluginName(pluginMap.get(active), locale) || active}</span>
        </div>
        <div className="dl-titlebar-right">
          <div className="dl-winbtns">
            <div className="dl-winbtn" onClick={() => winControl('minimize')}>
              <WinIcon src={icChromeMinimize} />
            </div>
            <div className="dl-winbtn" onClick={() => winControl(maximized ? 'unmaximize' : 'maximize')}>
              <WinIcon src={maximized ? icChromeUnmaximize : icChromeMaximize} />
            </div>
            <div className="dl-winbtn dl-close" onClick={() => winControl('close')}>
              <WinIcon src={icChromeClose} />
            </div>
          </div>
        </div>
      </header>

      {/* ===== 主体 ===== */}
      <div className="dl-body">
        {/* 活动栏 */}
        <aside className="dl-rail">
          {/* 操作台（layout 自有页） */}
          <button
            type="button"
            aria-label={String(t(`${NS}.console`))}
            title={String(t(`${NS}.console`))}
            className={`dl-rail-btn ${active === CONSOLE ? 'active' : ''}`}
            onClick={() => setActive(CONSOLE)}
          >
            <img src={iconUrl} alt="" className="dl-rail-icon dl-rail-img" />
          </button>

          {/* 已打开的应用（keep-alive 切换）；放不下时折叠进「···」弹出面板 */}
          <div className="dl-rail-apps" ref={railAppsRef}>
            {railVisibleApps.map((id) => {
              const p = pluginMap.get(id)
              const displayName = pluginName(p, locale) || id
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={displayName}
                  title={displayName}
                  className={`dl-rail-btn ${active === id ? 'active' : ''}`}
                  onClick={() => void openRequest(id)}
                  onContextMenu={(e) => onRailContextMenu(e, id)}
                >
                  {p?.icon ? (
                    <PluginIcon pluginId={id} icon={p.icon} name={displayName} size={22} active={active === id} className="dl-rail-icon" />
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1 }}>
                      {displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </button>
              )
            })}

            {/* 溢出折叠：其余应用收进「···」，hover 弹出右侧列表点击打开 */}
            {railHiddenApps.length > 0 && (
              <div className="dl-rail-more" onMouseEnter={openMore} onMouseLeave={closeMore}>
                <button
                  ref={moreBtnRef}
                  type="button"
                  aria-label={String(t(`${NS}.moreApps`))}
                  title={String(t(`${NS}.moreApps`))}
                  className={`dl-rail-btn ${railHiddenActive ? 'active' : ''}`}
                  onMouseEnter={openMore}
                  onMouseLeave={closeMore}
                >
                  <span className="dl-rail-icon dl-rail-mask" style={{ maskImage: `url("${moreUrl}")`, WebkitMaskImage: `url("${moreUrl}")` }} />
                </button>
                {moreOpen && morePos && (
                  <div
                    className="dl-rail-more-panel"
                    style={{ left: morePos.x, top: morePos.y }}
                    onMouseEnter={openMore}
                    onMouseLeave={closeMore}
                  >
                    {railHiddenApps.map((id) => {
                      const p = pluginMap.get(id)
                      const displayName = pluginName(p, locale) || id
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`dl-rail-more-item ${active === id ? 'active' : ''}`}
                          onClick={() => {
                            setMoreOpen(false)
                            void openRequest(id)
                          }}
                          onContextMenu={(e) => onRailContextMenu(e, id)}
                        >
                          {p?.icon ? (
                            <PluginIcon pluginId={id} icon={p.icon} name={displayName} size={18} active={active === id} className="dl-rail-icon dl-rail-icon-sm" />
                          ) : (
                            <span className="dl-rail-more-fallback">{displayName.slice(0, 1).toUpperCase()}</span>
                          )}
                          <span className="dl-rail-more-name">{displayName}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 底部：设置（内置页）；导入插件入口在操作台页右上 */}
          <button
            type="button"
            aria-label={String(t(`${NS}.console`))}
            title="设置"
            className={`dl-rail-btn ${active === SETTING ? 'active' : ''}`}
            onClick={() => void openRequest(SETTING)}
          >
            <SettingRailIcon className="dl-rail-fixed-icon" />
          </button>
        </aside>

        {/* 内容区：keep-alive（所有已打开页面常驻，display 控制显隐） */}
        <main className="dl-main">
          <div className="dl-page" style={{ display: active === CONSOLE ? 'block' : 'none' }}>
            <ConsolePage recentApps={recentApps} installedApps={installedApps} opened={opened} unready={(id) => unready.has(id)} onOpen={openRequest} />
          </div>
          {opened.includes(SETTING) && (
            <div className="dl-page" style={{ display: active === SETTING ? 'block' : 'none' }}>
              <SettingPage />
            </div>
          )}
          {openedApps.map((id) => (
            <div key={id} className="dl-page" style={{ display: active === id ? 'block' : 'none' }}>
              <PluginBoot pluginId={id} />
            </div>
          ))}
        </main>
      </div>
    </div>
  )
}
