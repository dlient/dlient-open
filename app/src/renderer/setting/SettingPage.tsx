/**
 * 内置设置页（src/renderer/setting/SettingPage.tsx，开源版并入宿主）。
 * 功能：语言 / 主题 / 开机自启动 / 全局快捷键（录制）/ 关于（版本 + Node.js 运行环境）。
 * 数据经 window.dlient.hostShell.settingsGet / settingsSet 持久化（~/.dlient/settings.json）；
 * 主题 / 语言变更由主进程广播 theme / language 通道全端生效。
 * 开源版无账户 / 设备管理（无 auth / 服务端）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, MessagePlugin, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@dlient-open/ui'
import { useI18n } from '@dlient-open/i18n'
import './styles.css'
import './i18n'

const NS = 'plugin-setting'
const SHORTCUT_ID = 'show-main-window'

interface AppSettings {
  language?: 'zh-CN' | 'en-US'
  theme?: 'light' | 'dark' | 'system'
  autoLaunch?: boolean
  shortcuts?: Record<string, string>
}

/** 解析加速键为 keycap 展示（⌘/Ctrl、⇧、⌥/Alt…） */
function parseAccelerator(acc?: string): string[] {
  if (!acc) return []
  return acc.split('+').map((part) => {
    switch (part) {
      case 'CommandOrControl': return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
      case 'Shift': return '⇧'
      case 'Alt': return navigator.platform.includes('Mac') ? '⌥' : 'Alt'
      case 'Meta': return '⌘'
      default: return part
    }
  })
}

/** 特殊物理键码（KeyboardEvent.code）→ Electron accelerator 键名 */
const SPECIAL_KEY_CODES: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  CapsLock: 'Capslock',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  PrintScreen: 'PrintScreen',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

/** 录制：把 keydown 转成 Electron accelerator 字符串（用 e.code 物理键，避免 Shift+= 拼出无效串） */
function toAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const code = e.code
  let key: string | undefined
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`
  else key = SPECIAL_KEY_CODES[code]
  if (!key) return null
  parts.push(key)
  return parts.length > 1 ? parts.join('+') : null
}

export default function SettingPage() {
  const { t, locale } = useI18n()

  const [settings, setSettings] = useState<AppSettings>({})
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [about, setAbout] = useState<{ name: string; version: string; locale: string; platform: string } | null>(null)
  const [nodejs, setNodejs] = useState<{ ready: boolean; satisfies: boolean } | null>(null)
  const [installingNode, setInstallingNode] = useState(false)

  const loadSettings = useCallback(() => {
    void window.dlient.hostShell
      .settingsGet()
      .then((s) => setSettings(s ?? {}))
      .catch((err) => console.error('[setting] settingsGet failed:', err))
  }, [])

  useEffect(() => {
    loadSettings()
    void window.dlient.hostShell.about().then(setAbout).catch(() => undefined)
    void window.dlient.hostShell
      .nodejsStatus()
      .then((s) => setNodejs({ ready: s.ready, satisfies: s.satisfies }))
      .catch(() => undefined)
    // 主题/语言由主进程广播应用；此处仅回填表单状态（语言切换后重拉）
    const offLanguage = window.dlient.on('language', loadSettings)
    return offLanguage
  }, [loadSettings])

  const save = useCallback(
    async (partial: Partial<AppSettings>) => {
      try {
        const merged = await window.dlient.hostShell.settingsSet(partial)
        setSettings((merged as AppSettings) ?? {})
      } catch (err) {
        console.error('[setting] settingsSet failed:', err)
        MessagePlugin.error(String(t(`${NS}.saveFailed`)))
      }
    },
    [t],
  )

  const setTheme = (theme: 'light' | 'dark' | 'system') => void save({ theme })
  const setLanguage = (language: 'zh-CN' | 'en-US') => void save({ language })
  const setAutoLaunch = (autoLaunch: boolean) => void save({ autoLaunch })

  /** 保存快捷键（注册失败主进程不落盘；重新拉取还原显示） */
  const saveShortcut = useCallback(
    async (id: string, acc: string) => {
      try {
        const merged = await window.dlient.hostShell.settingsSet({ shortcuts: { ...(settings.shortcuts ?? {}), [id]: acc } })
        setSettings((merged as AppSettings) ?? {})
      } catch (err) {
        console.error('[setting] saveShortcut failed:', err)
        MessagePlugin.error(String(t(`${NS}.shortcutFailed`)))
        loadSettings()
      }
    },
    [settings.shortcuts, t, loadSettings],
  )

  /** 重置全部：只保留「显示主窗口」默认值 */
  const resetAll = useCallback(async () => {
    try {
      const merged = await window.dlient.hostShell.settingsSet({ shortcuts: { [SHORTCUT_ID]: 'CommandOrControl+Shift+Space' } })
      setSettings((merged as AppSettings) ?? {})
    } catch (err) {
      console.error('[setting] resetAll failed:', err)
      MessagePlugin.error(String(t(`${NS}.shortcutFailed`)))
    }
  }, [t])

  const handleShortcutRowClick = useCallback((id: string) => {
    setRecordingId((cur) => (cur === id ? null : id))
  }, [])

  // 录制监听：keydown 产出合法组合后保存；Escape 或点击行外区域 → 取消
  useEffect(() => {
    if (!recordingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      const acc = toAccelerator(e)
      if (!acc) return
      const id = recordingId
      setRecordingId(null)
      void saveShortcut(id, acc)
    }
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-recording-row]')) return
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouseDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [recordingId, saveShortcut])

  /** 安装 Node.js 运行时（按需惰性；仅设置页提供入口，插件打开时亦自动触发） */
  const installNode = useCallback(async () => {
    if (installingNode) return
    setInstallingNode(true)
    try {
      await window.dlient.hostShell.nodejsInstall()
      const s = await window.dlient.hostShell.nodejsStatus()
      setNodejs({ ready: s.ready, satisfies: s.satisfies })
      MessagePlugin.success(String(t(`${NS}.nodejsInstallDone`)))
    } catch (err) {
      MessagePlugin.error(String(err instanceof Error ? err.message : err))
    } finally {
      setInstallingNode(false)
    }
  }, [installingNode, t])

  const shortcutAcc = (settings.shortcuts ?? {})[SHORTCUT_ID]

  return (
    <div className="st-root">
      <div className="st-page">
        {/* 页头 */}
        <div className="st-header">
          <h1 className="st-title">{t(`${NS}.title`)}</h1>
          <p className="st-subtitle">{t(`${NS}.subtitle`)}</p>
        </div>

        {/* 系统设置 */}
        <section className="st-section">
          <div className="st-section-head">
            <h2 className="st-section-title">{t(`${NS}.system`)}</h2>
            <p className="st-section-sub">{t(`${NS}.systemSub`)}</p>
          </div>
          <div className="st-hr" />

          {/* 语言 */}
          <div className="st-row">
            <div className="st-row-label">
              <span className="st-row-title">{t(`${NS}.language`)}</span>
              <span className="st-row-sub">{t(`${NS}.languageSub`)}</span>
            </div>
            <Select value={locale === 'zh-CN' ? 'zh-CN' : 'en-US'} onValueChange={(v) => setLanguage(v as 'zh-CN' | 'en-US')}>
              <SelectTrigger style={{ width: 200 }} aria-label={String(t(`${NS}.language`))}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">{t(`${NS}.langZh`)}</SelectItem>
                <SelectItem value="en-US">{t(`${NS}.langEn`)}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 主题 */}
          <div className="st-row">
            <div className="st-row-label">
              <span className="st-row-title">{t(`${NS}.theme`)}</span>
              <span className="st-row-sub">{t(`${NS}.themeSub`)}</span>
            </div>
            <Select value={settings.theme ?? 'system'} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
              <SelectTrigger style={{ width: 200 }} aria-label={String(t(`${NS}.theme`))}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t(`${NS}.light`)}</SelectItem>
                <SelectItem value="dark">{t(`${NS}.dark`)}</SelectItem>
                <SelectItem value="system">{t(`${NS}.systemTheme`)}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 开机自启动 */}
          <div className="st-row">
            <div className="st-row-label">
              <span className="st-row-title">{t(`${NS}.autoLaunch`)}</span>
              <span className="st-row-sub">{t(`${NS}.autoLaunchSub`)}</span>
            </div>
            <Switch checked={!!settings.autoLaunch} onCheckedChange={(v) => setAutoLaunch(v === true)} />
          </div>
        </section>

        {/* 快捷键设置 */}
        <section className="st-section">
          <div className="st-shortcut-head">
            <h2 className="st-section-title">{t(`${NS}.shortcuts`)}</h2>
            <Button variant="ghost" size="sm" onClick={() => void resetAll()}>
              {t(`${NS}.resetAll`)}
            </Button>
          </div>
          <div className="st-hr" />

          {shortcutAcc && (
            <div
              className={`st-shortcut-row ${recordingId === SHORTCUT_ID ? 'st-recording' : ''}`}
              data-recording-row={recordingId === SHORTCUT_ID ? '' : undefined}
              onClick={() => handleShortcutRowClick(SHORTCUT_ID)}
              title={String(t(`${NS}.shortcutClickHint`))}
            >
              <span className="st-shortcut-label">{t(`${NS}.openMainWindow`)}</span>
              <div className="st-shortcut-ctrl">
                {parseAccelerator(shortcutAcc).map((kc, i) => (
                  <span key={i} className="st-keycap">
                    {kc}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="st-shortcut-tip">{t(`${NS}.shortcutTip`)}</p>
        </section>

        {/* 关于 */}
        <section className="st-section">
          <div className="st-section-head">
            <h2 className="st-section-title">{t(`${NS}.about`)}</h2>
            <p className="st-section-sub">{t(`${NS}.aboutSub`)}</p>
          </div>
          <div className="st-hr" />

          <div className="st-row">
            <div className="st-row-label">
              <span className="st-row-title">{t(`${NS}.version`)}</span>
            </div>
            <span className="st-row-value">{about ? `${about.name} v${about.version}` : '-'}</span>
          </div>

          <div className="st-row">
            <div className="st-row-label">
              <span className="st-row-title">{t(`${NS}.platform`)}</span>
            </div>
            <span className="st-row-value">{about?.platform ?? '-'}</span>
          </div>

          <div className="st-row">
            <div className="st-row-label">
              <span className="st-row-title">{t(`${NS}.nodejs`)}</span>
            </div>
            {nodejs?.ready ? (
              <span className="st-row-value">{t(`${NS}.nodejsReady`)}</span>
            ) : (
              <Button variant="outline" size="sm" loading={installingNode} disabled={installingNode} onClick={() => void installNode()}>
                {installingNode ? t(`${NS}.nodejsInstalling`) : t(`${NS}.installNodejs`)}
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
