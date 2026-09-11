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

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Badge, Button, Empty, FileUp, Github, Input, Link, Loader2Icon, MessagePlugin, Package, PluginIcon, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, modal } from '@dlient-open/ui'
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

/** NPM 市场分类标签：key 即 npm 检索关键词（插件包 keywords 中需含对应 key 才能被分类筛到） */
const MARKET_CATEGORIES: Array<{ key: string; zh: string; en: string }> = [
  { key: 'ai', zh: 'AI 智能', en: 'AI & Intelligence' },
  { key: 'productivity', zh: '办公效率', en: 'Productivity & Office' },
  { key: 'content-creation', zh: '内容创作', en: 'Content Creation' },
  { key: 'dev-tools', zh: '开发工具', en: 'Development Tools' },
  { key: 'ui-design', zh: '界面设计', en: 'UI & Design' },
  { key: 'finance', zh: '金融财务', en: 'Finance & Accounting' },
  { key: 'games', zh: '游戏娱乐', en: 'Games & Entertainment' },
  { key: 'education', zh: '教育学习', en: 'Education & Learning' },
  { key: 'system', zh: '系统工具', en: 'System Utilities' },
]

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

/** 应用卡片：图标 + 名称 + 版本(类型徽标) + 描述；应用可打开，插件点击提示不可打开；依赖缺失显示未就绪标识 */
function AppCard({
  plugin,
  unready,
  onOpen,
}: {
  plugin: InstalledPluginInfo
  unready?: boolean
  onOpen: (id: string) => void
}) {
  const { t, locale } = useI18n()
  const name = resolveLocalized(plugin.nameL10n ?? plugin.name, locale)
  const description = resolveLocalized(plugin.descriptionL10n ?? plugin.description, locale)
  const isApp = plugin.type === 'app'
  const open = () => {
    if (isApp) onOpen(plugin.id)
    else MessagePlugin.info(String(t(`${NS}.pluginNotOpenable`)))
  }
  return (
    <article
      className={`dl-card ${unready ? 'dl-card-unready' : 'dl-card-click'} ${isApp ? '' : 'dl-card--plugin'}`}
      onClick={open}
    >
      <div className="dl-card-head">
        <PluginIcon pluginId={plugin.id} icon={plugin.icon} name={name} size={36} className="dl-card-icon" />
        <div className="dl-card-meta">
          <div className="dl-card-name-row">
            <span className="dl-card-name">{name}</span>
            {unready && <span className="dl-unready-badge">{t(`${NS}.unready`)}</span>}
          </div>
          <span className="dl-card-version">
            v{plugin.version}
            <span className={`dl-card-kind dl-card-kind--${isApp ? 'app' : 'plugin'}`}>
              {isApp ? t(`${NS}.kindApp`) : t(`${NS}.kindPlugin`)}
            </span>
          </span>
        </div>
      </div>
      {description && <div className="dl-card-desc">{description}</div>}
    </article>
  )
}

/** NPM 市场条目（main 已按 dlient manifest 富化/过滤：仅有效插件） */
type NpmMarketItem = {
  name: string
  /** dlient 显示名（多语言对象/字符串；渲染层按当前语言解析） */
  title?: unknown
  id: string
  version: string
  type: 'app' | 'plugin'
  /** dlient 描述（多语言对象/字符串；渲染层按当前语言解析） */
  description?: unknown
  date: string
}

/** 简单 semver 比较：忽略前缀 v 与 prerelease 后缀，仅比较主/次/修订数字段；a>b 返回 1，相等 0，a<b 返回 -1 */
function compareVersions(a: string, b: string): number {
  const pa = String(a ?? '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = String(b ?? '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va > vb ? 1 : -1
  }
  return 0
}

/** 市场卡片：无图标；版本(默认徽标) + 类型(success/warning 徽标)；查看(npm) + 导入/更新/已安装 按钮 */
function MarketCard({
  item,
  installed,
  updatable,
  onInstall,
}: {
  item: NpmMarketItem
  /** 已安装（按 dlient.id 匹配） */
  installed: boolean
  /** 市场版本高于已安装版本（按钮变为「更新」） */
  updatable: boolean
  /** 导入（npm 包名）：解析成功弹确认框返回 true；失败返回 false */
  onInstall: (source: string) => Promise<boolean>
}) {
  const { t, locale } = useI18n()
  const [installing, setInstalling] = useState(false)
  const name = resolveLocalized(item.title, locale) || item.name
  const description = resolveLocalized(item.description, locale)
  const isApp = item.type === 'app'
  const canAct = !installed || updatable
  const install = async () => {
    if (installing || !canAct) return
    setInstalling(true)
    try {
      await onInstall(item.name)
    } finally {
      setInstalling(false)
    }
  }
  const viewNpm = () => {
    void window.dlient.hostShell
      .openExternal(`https://www.npmjs.com/package/${encodeURIComponent(item.name)}`)
      .catch(() => undefined)
  }
  return (
    <article className="dl-card">
      <div className="dl-card-meta">
        <div className="dl-card-name-row">
          <span className="dl-card-name">{name}</span>
        </div>
        <span className="dl-card-badges">
          <Badge variant="default">v{item.version}</Badge>
          <Badge variant={isApp ? 'success' : 'warning'}>{isApp ? t(`${NS}.kindApp`) : t(`${NS}.kindPlugin`)}</Badge>
        </span>
      </div>
      {description ? <div className="dl-card-desc">{description}</div> : null}
      <div className="dl-card-actions">
        <Button size="sm" variant="outline" onClick={viewNpm}>
          {t(`${NS}.marketView`)}
        </Button>
        <Button
          size="sm"
          loading={installing}
          disabled={!canAct || installing}
          onClick={install}
        >
          {!installed ? t(`${NS}.marketInstall`) : updatable ? t(`${NS}.marketUpdate`) : t(`${NS}.marketInstalled`)}
        </Button>
      </div>
    </article>
  )
}

type ImportReviewPerm = { key: string; level: string; description?: { 'zh-CN': string; 'en-US': string } | null }
type ImportReviewDep = { id: string; source: string; kind: 'npm' | 'github' | 'url' }

/** 权限风险权重（数值小的排前面）：dangerous 高风险置顶，其次 warn，最后 default */
const PERM_RISK_WEIGHT: Record<string, number> = { dangerous: 0, warn: 1, default: 2 }

/** 权限按危险等级排序：高风险在上（同级别保持 manifest 声明顺序） */
function sortPermsByRisk(list: ImportReviewPerm[]): ImportReviewPerm[] {
  return [...list].sort((a, b) => (PERM_RISK_WEIGHT[a.level] ?? 2) - (PERM_RISK_WEIGHT[b.level] ?? 2))
}

/**
 * 导入确认弹框正文：插件名/版本/描述 + 「权限 / 依赖」两个 tab。
 * - 权限：key（风险色点）+ 说明，两行一条；高风险在前
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
  const perms = sortPermsByRisk(preview.permissions)

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
        perms.length === 0 ? (
          <p className="dl-import-review-empty">{t(`${NS}.importNoPerms`)}</p>
        ) : (
          <ul className="dl-import-perms">
            {perms.map((it) => {
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
      ) : (
        <div className="dl-import-deps-panel">
          {deps.length === 0 ? (
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
      )}
    </div>
  )
}

/** 导入来源类型：本地 .dlient 文件 / 直链网址 / npm 包 / GitHub 仓库 */
type ImportSourceKind = 'local' | 'url' | 'npm' | 'github'

/**
 * 导入来源对话框正文：上方 4 个来源选框（本地文件 / 网址 / NPM 包 / Github，各带图标），
 * 下方按来源显示「文件框（可点击、可拖入）」或「输入框」，最下方为全宽提交按钮。
 */
function ImportSourceDialog({
  onLocalPreview,
  onImportSource,
  onDone,
}: {
  /** 本地文件：不传路径 = 弹系统选择框；传路径 = 拖入的文件。解析成功（已弹确认框）返回 true */
  onLocalPreview: (filePath?: string) => Promise<boolean>
  /** npm / github / 网址：拉包解析。解析成功（已弹确认框）返回 true */
  onImportSource: (source: string) => Promise<boolean>
  /** 解析成功、确认框已弹出后调用（此时才关闭本弹框） */
  onDone: () => void
}) {
  const { t } = useI18n()
  const [kind, setKind] = useState<ImportSourceKind>('local')
  const [value, setValue] = useState('')
  const [dropHover, setDropHover] = useState(false)
  const [busy, setBusy] = useState(false)

  const tabs: Array<{ id: ImportSourceKind; label: string; Icon: typeof FileUp }> = [
    { id: 'local', label: String(t(`${NS}.importTabLocal`)), Icon: FileUp },
    { id: 'url', label: String(t(`${NS}.importTabUrl`)), Icon: Link },
    { id: 'npm', label: String(t(`${NS}.importTabNpm`)), Icon: Package },
    { id: 'github', label: String(t(`${NS}.importTabGithub`)), Icon: Github },
  ]

  const hint =
    kind === 'local'
      ? String(t(`${NS}.importLocalHint`))
      : kind === 'url'
        ? String(t(`${NS}.importUrlHint`))
        : kind === 'npm'
          ? String(t(`${NS}.importNpmHint`))
          : String(t(`${NS}.importGithubHint`))
  const placeholder =
    kind === 'url'
      ? String(t(`${NS}.importUrlPlaceholder`))
      : kind === 'npm'
        ? String(t(`${NS}.importNpmPlaceholder`))
        : String(t(`${NS}.importGithubPlaceholder`))

  /**
   * 执行一次解析：期间保持弹框打开、按钮显示 loading；
   * 解析成功（确认框已弹出）才关闭本弹框，失败则留在原地让用户修改输入。
   */
  const run = async (task: () => Promise<boolean>) => {
    if (busy) return
    setBusy(true)
    let ok = false
    try {
      ok = await task()
    } finally {
      setBusy(false)
    }
    if (ok) onDone()
  }

  /** 拖入 .dlient：Electron 32+ 已移除 File.path，经 preload 的 webUtils 取真实路径 */
  const onDrop = (e: ReactDragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setDropHover(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    const filePath = window.dlient.hostShell.getPathForFile(file)
    if (filePath) void run(() => onLocalPreview(filePath))
  }

  const submit = () => {
    if (kind === 'local') void run(() => onLocalPreview())
    else if (value.trim()) void run(() => onImportSource(value.trim()))
  }

  return (
    <div className="dl-import-source">
      <div className="dl-import-kinds" role="tablist">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            className={`dl-import-kind ${kind === id ? 'active' : ''}`}
            disabled={busy}
            onClick={() => {
              setKind(id)
              setValue('')
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="dl-import-body">
        <p className="dl-import-hint">{hint}</p>
        {kind === 'local' ? (
          <button
            type="button"
            className={`dl-import-dropzone ${dropHover ? 'hover' : ''}`}
            disabled={busy}
            onClick={submit}
            onDragOver={(e) => {
              e.preventDefault()
              setDropHover(true)
            }}
            onDragLeave={() => setDropHover(false)}
            onDrop={onDrop}
          >
            <FileUp size={20} />
            <span>{String(t(`${NS}.importBtnPick`))}</span>
          </button>
        ) : (
          <Input
            autoFocus
            placeholder={placeholder}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        )}
      </div>

      <Button
        size="lg"
        className="dl-import-submit"
        loading={busy}
        onClick={submit}
        disabled={kind !== 'local' && !value.trim()}
      >
        {kind === 'local' ? String(t(`${NS}.importBtnPick`)) : String(t(`${NS}.importBtnImport`))}
      </Button>
    </div>
  )
}

type ConsoleTab = 'installed' | 'market'
type KindFilter = 'all' | 'app' | 'plugin'
type MarketSort = 'downloads' | 'date'

/** 操作台（layout 自有页）：已安装 / NPM市场 两个 tab（自定义 tab，切换不重渲染）+ 吸顶头部 + 类型筛选/搜索工具条 */
function ConsolePage({
  plugins,
  recent,
  unready,
  onOpen,
  onInstallSource,
}: {
  plugins: InstalledPluginInfo[]
  recent: string[]
  unready: (id: string) => boolean
  onOpen: (id: string) => void
  /** 市场卡片导入（npm 包名 → 复用预览确认 → 安装链路） */
  onInstallSource: (source: string) => Promise<boolean>
}) {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<ConsoleTab>('installed')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [installedQuery, setInstalledQuery] = useState('')
  const [marketSort, setMarketSort] = useState<MarketSort>('downloads')
  const [marketTag, setMarketTag] = useState('')
  const [marketItems, setMarketItems] = useState<NpmMarketItem[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketEnded, setMarketEnded] = useState(false)
  const marketInited = useRef(false)
  const marketSeq = useRef(0)
  const marketItemsRef = useRef<NpmMarketItem[]>([])
  const marketQueryRef = useRef('')
  const marketSortRef = useRef<MarketSort>('downloads')
  const marketKindRef = useRef<KindFilter>('all')
  const marketTagRef = useRef('')
  useEffect(() => {
    marketItemsRef.current = marketItems
  }, [marketItems])

  /** 已安装清单：按打开时间排序（最近在前），未打开过的排最后（按名称） */
  const installedList = useMemo(() => {
    const rank = new Map(recent.map((id, i) => [id, i]))
    const list = plugins.filter((p) => p.source !== 'dev' && !p.system && p.id !== CONSOLE && p.id !== SETTING)
    return [...list].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return (pluginName(a, locale) || a.id).localeCompare(pluginName(b, locale) || b.id)
    })
  }, [plugins, recent, locale])

  /** 已安装：类型 + 搜索过滤（应用可打开，插件不可打开） */
  const filteredInstalled = useMemo(() => {
    const q = installedQuery.trim().toLowerCase()
    return installedList.filter((p) => {
      if (kindFilter === 'app' && p.type !== 'app') return false
      if (kindFilter === 'plugin' && p.type === 'app') return false
      if (!q) return true
      const name = (pluginName(p, locale) || p.id).toLowerCase()
      return name.includes(q) || p.id.toLowerCase().includes(q)
    })
  }, [installedList, installedQuery, kindFilter, locale])

  /** 市场：类型过滤（客户端，作用于已加载列表） */
  const filteredMarket = useMemo(
    () =>
      marketItems.filter((it) =>
        kindFilter === 'all' ? true : kindFilter === 'app' ? it.type === 'app' : it.type === 'plugin',
      ),
    [marketItems, kindFilter],
  )

  /** 已安装插件版本表（市场卡片据此判断「已安装」与「可更新」） */
  const installedVersions = useMemo(() => new Map(plugins.map((p) => [p.id, p.version])), [plugins])

  /** 执行市场搜索（reset=从头 / false=加载更多追加） */
  const runMarketSearch = useCallback(async (reset: boolean) => {
    const seq = ++marketSeq.current
    const q = marketQueryRef.current
    const sort = marketSortRef.current
    const kind = marketKindRef.current
    const tag = marketTagRef.current
    setMarketError('')
    if (reset) {
      setMarketItems([])
      setMarketEnded(false)
    }
    setMarketLoading(true)
    try {
      const from = reset ? 0 : marketItemsRef.current.length
      const res = await window.dlient.hostShell.searchNpmMarket({ q, sort, kind, tag, from, size: 30 })
      if (seq !== marketSeq.current) return
      if (!res.ok) {
        setMarketError(res.error ?? '')
        return
      }
      setMarketItems((prev) => (reset ? res.items : [...prev, ...res.items]))
      if (res.items.length === 0 || !res.hasMore) setMarketEnded(true)
    } catch (err) {
      if (seq === marketSeq.current) setMarketError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === marketSeq.current) setMarketLoading(false)
    }
  }, [])

  /** 首次切到市场 tab 自动按关键词搜索（之后切回保留结果，不重渲染） */
  const activateMarket = () => {
    setTab('market')
    if (!marketInited.current) {
      marketInited.current = true
      marketKindRef.current = kindFilter
      marketTagRef.current = marketTag
      void runMarketSearch(true)
    }
  }

  /** 类型筛选变化：已安装 tab 仅客户端过滤；市场 tab 作为检索关键词重新搜索 */
  const onKindChange = (v: KindFilter) => {
    setKindFilter(v)
    if (tab !== 'market' || !marketInited.current) return
    marketKindRef.current = v
    void runMarketSearch(true)
  }

  /** 分类标签点击：单选切换（再点取消）；市场 tab 按标签关键词重新搜索 */
  const onTagChange = (key: string) => {
    const next = marketTag === key ? '' : key
    setMarketTag(next)
    if (tab !== 'market' || !marketInited.current) return
    marketTagRef.current = next
    void runMarketSearch(true)
  }

  const submitSearch = () => {
    if (tab === 'installed') {
      setInstalledQuery(search)
      return
    }
    marketQueryRef.current = search.trim()
    marketSortRef.current = marketSort
    marketKindRef.current = kindFilter
    marketTagRef.current = marketTag
    marketInited.current = true
    void runMarketSearch(true)
  }

  /** 切换市场排序：已搜索过则按新排序重新搜索 */
  const onSortChange = (v: MarketSort) => {
    setMarketSort(v)
    if (!marketInited.current) return
    marketSortRef.current = v
    void runMarketSearch(true)
  }

  /** 市场：滚动到底加载更多 */
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (tab !== 'market') return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        if (marketLoading || marketEnded) return
        void runMarketSearch(false)
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [tab, marketLoading, marketEnded, runMarketSearch])

  return (
    <div className="dl-console">
      {/* 吸顶：页头 + tab 栏 + 工具条（滚动时保持可见） */}
      <div className="dl-console-sticky">
        <div className="dl-console-header">
          <div className="dl-console-title-block">
            <h1 className="dl-console-title">{t(`${NS}.console`)}</h1>
            <p className="dl-console-sub">{t(`${NS}.consoleSub`)}</p>
          </div>
          <Button variant="default" onClick={() => onOpen('__import__')}>
            {t(`${NS}.importTitle`)}
          </Button>
        </div>

        <div className="dl-console-tabbar">
          <div className="dl-console-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'installed'}
              className={`dl-console-tab ${tab === 'installed' ? 'active' : ''}`}
              onClick={() => setTab('installed')}
            >
              {t(`${NS}.consoleTabsInstalled`)}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'market'}
              className={`dl-console-tab ${tab === 'market' ? 'active' : ''}`}
              onClick={activateMarket}
            >
              {t(`${NS}.consoleTabsMarket`)}
            </button>
          </div>
          <div className="dl-console-toolbar">
            <Select
              value={kindFilter}
              onValueChange={(v) => onKindChange(v as KindFilter)}
            >
              <SelectTrigger size="sm" aria-label={String(t(`${NS}.filterKind`))}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(`${NS}.filterAll`)}</SelectItem>
                <SelectItem value="app">{t(`${NS}.filterApp`)}</SelectItem>
                <SelectItem value="plugin">{t(`${NS}.filterPlugin`)}</SelectItem>
              </SelectContent>
            </Select>
            {tab === 'market' && (
              <Select
                value={marketSort}
                onValueChange={(v) => onSortChange(v as MarketSort)}
              >
                <SelectTrigger size="sm" aria-label={String(t(`${NS}.marketSortLabel`))}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="downloads">{t(`${NS}.marketSortDownloads`)}</SelectItem>
                  <SelectItem value="date">{t(`${NS}.marketSortDate`)}</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input
              className="dl-console-search"
              placeholder={String(t(`${NS}.searchPlaceholder`))}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSearch()
              }}
            />
            <Button size="sm" onClick={submitSearch}>
              {t(`${NS}.searchBtn`)}
            </Button>
          </div>
        </div>
      </div>

      <div className="dl-console-body">
        {/* 已安装：按打开时间排序；应用可打开 / 插件点击提示不可打开 */}
        <div className="dl-console-panel" style={{ display: tab === 'installed' ? 'block' : 'none' }}>
          {filteredInstalled.length === 0 ? (
            <div className="dl-empty-wrap">
              <Empty
                title={String(t(installedList.length === 0 ? `${NS}.installedEmpty` : `${NS}.installedNoMatch`))}
                description={
                  installedList.length === 0 ? String(t(`${NS}.installedEmptySub`)) : String(t(`${NS}.installedNoMatchSub`))
                }
                action={
                  installedList.length === 0 ? (
                    <Button variant="default" onClick={activateMarket}>
                      {t(`${NS}.goMarket`)}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="dl-grid">
              {filteredInstalled.map((p) => (
                <AppCard key={p.id} plugin={p} unready={unready(p.id)} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>

        {/* NPM市场：分类标签 + 关键词检索（dlient-open-plugin + 类型 + 标签 + 包名）+ 排序；每页 30 下拉加载更多 */}
        <div className="dl-console-panel" style={{ display: tab === 'market' ? 'block' : 'none' }}>
          <div className="dl-market-tags">
            {MARKET_CATEGORIES.map((cat) => {
              const active = marketTag === cat.key
              return (
                <button
                  key={cat.key}
                  type="button"
                  className={`dl-market-tag ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  onClick={() => onTagChange(cat.key)}
                >
                  {locale === 'en-US' ? cat.en : cat.zh}
                </button>
              )
            })}
          </div>
          {marketError ? (
            <p className="dl-console-error">{t(`${NS}.marketSearchFailed`, { reason: marketError })}</p>
          ) : marketLoading && marketItems.length === 0 ? (
            <div className="dl-market-loading">
              <Loader2Icon className="dl-spin" size={18} />
              <span>{t(`${NS}.marketSearching`)}</span>
            </div>
          ) : filteredMarket.length === 0 ? (
            <div className="dl-empty-wrap">
              <Empty title={String(t(`${NS}.marketEmpty`))} description={String(t(`${NS}.marketEmptySub`))} />
            </div>
          ) : (
            <>
              <div className="dl-grid">
                {filteredMarket.map((it) => {
                  const installedVer = installedVersions.get(it.id)
                  return (
                    <MarketCard
                      key={it.name}
                      item={it}
                      installed={installedVer != null}
                      updatable={installedVer != null && compareVersions(it.version, installedVer) > 0}
                      onInstall={onInstallSource}
                    />
                  )
                })}
              </div>
              <div className="dl-market-status">
                {marketLoading ? (
                  <span className="dl-market-status-item">
                    <Loader2Icon className="dl-spin" size={14} />
                    {t(`${NS}.marketLoadingMore`)}
                  </span>
                ) : marketEnded ? (
                  <span>{t(`${NS}.marketEnd`, { count: marketItems.length })}</span>
                ) : null}
              </div>
              {!marketEnded && <div ref={sentinelRef} className="dl-market-sentinel" />}
            </>
          )}
        </div>
      </div>
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

  const pluginMap = useMemo(() => new Map(plugins.map((p) => [p.id, p])), [plugins])

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

  /**
   * 导入 .dlient 插件（本地文件）：选文件（或拖入的路径）→ 解析并弹「安装确认」框 → 确认后安装。
   * 返回 true 表示解析成功且确认框已弹出（调用方据此关闭来源弹框）。
   */
  const handleLocalImport = useCallback(async (filePath?: string): Promise<boolean> => {
    let res: Awaited<ReturnType<typeof window.dlient.hostShell.previewImportPlugin>>
    try {
      res = await window.dlient.hostShell.previewImportPlugin(filePath)
    } catch (err) {
      MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: err instanceof Error ? err.message : String(err) })))
      return false
    }
    if (!res) return false // 取消文件选择
    if (!res.ok || !res.preview) {
      MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: res.error ?? '' })))
      return false
    }
    const preview = res.preview
    void modal.info({
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
    return true
  }, [t, runImportInstall])

  /**
   * 导入 .dlient 插件（npm / github / 网址）：预览拉包 → 弹「安装确认」框 → 确认后安装；取消清理临时文件。
   * 返回 true 表示解析成功且确认框已弹出（调用方据此关闭来源弹框）。
   */
  const handleImportSource = useCallback(
    async (source: string): Promise<boolean> => {
      let res: Awaited<ReturnType<typeof window.dlient.hostShell.previewImportSource>>
      try {
        res = await window.dlient.hostShell.previewImportSource(source)
      } catch (err) {
        MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: err instanceof Error ? err.message : String(err) })))
        return false
      }
      if (!res.ok) {
        MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: res.error ?? '' })))
        return false
      }
      const token = res.token
      const preview = res.preview
      void modal.info({
        description: <ImportReviewBody preview={preview} />,
        width: 460,
        confirmBtn: t(`${NS}.importConfirm`),
        cancelBtn: t(`${NS}.importCancel`),
        onConfirm: async (ctx) => {
          const r = await window.dlient.hostShell
            .installImportSource(token)
            .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
          if (r.ok) {
            MessagePlugin.success(String(t(`${NS}.importDone`, { name: r.name ?? r.id ?? '' })))
            reloadPlugins()
            if (r.id) void openRequest(r.id)
            ctx.close()
            return true
          }
          MessagePlugin.error(String(t(`${NS}.importFailed`, { reason: r.error ?? '' })))
          return false
        },
        onCancel: () => {
          void window.dlient.hostShell.discardImportSource(token).catch(() => undefined)
        },
        onClose: () => {
          void window.dlient.hostShell.discardImportSource(token).catch(() => undefined)
        },
      })
      return true
    },
    [t, reloadPlugins, openRequest],
  )

  /** 导入插件入口：来源对话框（本地文件 / 网址 / npm 包 / github 四种来源） */
  const handleImport = useCallback(() => {
    const dlg = modal.dialog({
      header: (
        <div className="dl-import-header">
          <span className="dl-import-title">{t(`${NS}.importTitle`)}</span>
          <span className="dl-import-sub">{t(`${NS}.importHeaderDesc`)}</span>
        </div>
      ),
      width: 480,
      body: <ImportSourceDialog onLocalPreview={handleLocalImport} onImportSource={handleImportSource} onDone={() => dlg.close()} />,
    })
  }, [t, handleLocalImport, handleImportSource])

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
            <ConsolePage
              plugins={plugins}
              recent={recent}
              unready={(id) => unready.has(id)}
              onOpen={openRequest}
              onInstallSource={handleImportSource}
            />
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
