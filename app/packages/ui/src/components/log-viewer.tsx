/**
 * LogViewer - 插件日志查看组件（todo 任务 7.2.9）。
 *
 * 零配置即可查看本插件日志：
 *  - 历史：api.readPluginLogs() 读本插件 logs/（视图身份推导，无需传 pluginId）；history=N 只取最新 N 条（≤200）
 *  - 实时：api.subscribeLogs() 订阅 'plugin-log' 事件（只监听自己）
 *  - 下载 / 清空：默认读全量 + Blob 下载 / api.clearLogs() 清自己
 * 跨插件查看 dev 插件日志：传 filterId（逻辑 id）。宿主按 '<filterId>@dev' 处理（订阅/历史/清空/下载），
 * 未授权时显示待确认页 → 同意后经 requestPermissions（'logs.view.<filterId>'，runtime-confirm + 1 天授权）。
 */

import React from 'react'
import { Tooltip } from './ui/display'
import { DeleteIcon, DownloadIcon, SearchIcon } from './icon'
import { isApiOk, useDlientApi, type PluginLogEntry } from '@dlient-open/api-bridge'
import { useUiText } from './modal/i18n'

export interface LogViewerProps {
  /** 拉取最新多少条历史日志（1~200；缺省取读取源全量） */
  history?: number
  /** 跨插件查看 dev 插件日志：传逻辑 id 即可（宿主按 '<filterId>@dev' 处理；未授权先弹待确认页）。
   *  缺省 = 本插件自身日志 */
  filterId?: string
  /** 容器高度（缺省 480px） */
  height?: number | string
  /** 根容器 className（外层布局控制用） */
  className?: string
}

const LEVEL_ORDER = ['all', 'debug', 'info', 'warn', 'error'] as const
type LevelKey = (typeof LEVEL_ORDER)[number]

const LEVEL_LABELS: Record<Exclude<LevelKey, 'all'>, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
}

const LEVEL_COLORS: Record<string, string> = {
  debug: '#909399',
  info: '#409eff',
  warn: '#e6a23c',
  error: '#f56c6c',
}

/** history 上限 */
const HISTORY_MAX = 200

/** 错误码高亮：errCode 字段或 message 中的 [ERR -xxxx] 前缀 */
function extractErrCode(entry: PluginLogEntry): number | null {
  if (typeof entry.errCode === 'number') return entry.errCode
  if (typeof entry.err_code === 'number') return entry.err_code
  if (typeof entry.msg === 'string') {
    const m = /\[ERR\s*(-?\d+)\]/.exec(entry.msg)
    if (m && m[1] !== undefined) return Number(m[1])
  }
  return null
}

/** 单行解析：JSON 行 → 结构化条目；非 JSON 行原样展示（便于排查） */
function parseLine(line: string): PluginLogEntry {
  const trimmed = line.trim()
  if (!trimmed) return { ts: '', level: '', source: '', msg: '' }
  try {
    return JSON.parse(trimmed) as PluginLogEntry
  } catch {
    return { ts: '', level: '', source: '', msg: line }
  }
}

/** 级别归一：debug/info/warn/error（大小写均可）→ 小写；其余 → 空 */
function normLevel(level: unknown): string {
  if (typeof level !== 'string') return ''
  const l = level.toLowerCase()
  return l === 'debug' || l === 'info' || l === 'warn' || l === 'error' ? l : ''
}

/** 单条日志行：级别色标 + 时间 + 来源 + 消息 在第 1 行，data 其余字段 JSON 单独第 2 行（缩进），避免横向挤压 */
function LogRow({ entry }: { entry: PluginLogEntry }) {
  const { ts, level, source, msg, ...rest } = entry
  const errCode = extractErrCode(entry)
  const color = LEVEL_COLORS[level ?? ''] ?? '#909399'
  const extra = Object.keys(rest).length > 0 ? JSON.stringify(rest) : ''
  return (
    <div style={{ padding: '4px 10px', fontSize: 12, lineHeight: '18px', borderBottom: '1px solid rgba(128,128,128,0.12)', fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: '#909399', whiteSpace: 'nowrap', flexShrink: 0 }}>{ts || ''}</span>
        <span style={{ color, whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 600, width: 72 }}>{level?.toUpperCase() || ''}</span>
        <span style={{ color: '#7f9cf5', whiteSpace: 'nowrap', flexShrink: 0 }}>{source ? `[${source}]` : ''}</span>
        <span style={{ color: 'var(--foreground)', wordBreak: 'break-all' }}>{msg ?? ''}</span>
        {errCode !== null && <span style={{ color: '#f56c6c', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 600 }}>ERR {errCode}</span>}
      </div>
      {extra ? (
        <div style={{ paddingLeft: 20, marginTop: 2, color: '#909399', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{extra}</div>
      ) : null}
    </div>
  )
}

export function LogViewer({
  history,
  filterId,
  height = 480,
  className,
}: LogViewerProps) {
  const api = useDlientApi()
  const uiText = useUiText()
  const [entries, setEntries] = React.useState<PluginLogEntry[]>([])
  const [level, setLevel] = React.useState<LevelKey>('all')
  const [keyword, setKeyword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  /** 跨插件访问授权状态：filterId 非空且未授权 → 待确认页 */
  const [approved, setApproved] = React.useState(!filterId)
  const [denied, setDenied] = React.useState(false)
  /** 条数上限：防长时间运行内存无限增长（超出丢弃最早） */
  const MAX_ENTRIES = 3000
  /** history 归一：1~200，缺省取全量 */
  const historyLimit =
    history === undefined ? undefined : Math.max(1, Math.min(HISTORY_MAX, Math.floor(history)))

  const appendLine = React.useCallback((line: string) => {
    if (!line) return
    setEntries((prev) => {
      const next = [...prev, parseLine(line)]
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
    })
  }, [])

  /** 历史拉取：读本插件（filterId 缺省）或跨插件 '<filterId>@dev'；history=N 只取最新 N 条 */
  const readHistory = React.useCallback(async (): Promise<string[]> => {
    const res = await api.readPluginLogs({ maxBytes: 512 * 1024, filterId })
    const lines = Array.isArray(res?.lines) ? res.lines : []
    if (historyLimit !== undefined && lines.length > historyLimit) return lines.slice(lines.length - historyLimit)
    return lines
  }, [api, historyLimit, filterId])

  // 挂载：先拉历史 → 再注册实时订阅（api.subscribeLogs：本插件或跨插件 '<filterId>@dev'）；卸载时调用取消函数。
  // filterId 非空且未授权（approved=false）时跳过（显示待确认页），点击同意授权后 effect 重跑。
  React.useEffect(() => {
    if (!approved) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void (async () => {
      try {
        const lines = await readHistory()
        if (cancelled) return
        setEntries(lines.map(parseLine))
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
      if (cancelled) return
      try {
        unsubscribe = api.subscribeLogs((entry) => appendLine(entry.line), filterId)
      } catch {
        /* 订阅失败不阻塞展示历史 */
      }
    })()
    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readHistory, api, filterId, appendLine, approved])

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const e of entries) {
      const l = normLevel(e.level)
      if (l) c[l] += 1
    }
    return c
  }, [entries])

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return entries.filter((e) => {
      if (level !== 'all' && normLevel(e.level) !== level) return false
      if (kw && !JSON.stringify(e).toLowerCase().includes(kw)) return false
      return true
    })
  }, [entries, level, keyword])

  /** 下载：读全量（本插件或跨插件 '<filterId>@dev'）+ Blob 下载 */
  const handleDownload = React.useCallback(() => {
    void (async () => {
      try {
        const res = await api.readPluginLogs({ maxBytes: 4 * 1024 * 1024, filterId })
        const lines = Array.isArray(res?.lines) ? res.lines : []
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filterId ? `${filterId}.log` : 'plugin.log'
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        /* 下载失败静默 */
      }
    })()
  }, [api, filterId])

  /** 清空：api.clearLogs（本插件或跨插件 '<filterId>@dev'） */
  const handleClear = React.useCallback(() => {
    setEntries([])
    void api.clearLogs(filterId).catch(() => undefined)
  }, [api, filterId])

  /** 同意跨插件日志访问申请（方案C）：requestPermissions('logs.view.<filterId>') → 宿主 runtime-confirm + 1 天授权 */
  const handleApprove = React.useCallback(async () => {
    setDenied(false)
    setError(null)
    const cap = `logs.view.${filterId}`
    const res = await api.requestPermissions([cap]).catch(() => null)
    if (isApiOk(res) && Array.isArray(res.data?.granted) && res.data.granted.includes(cap)) {
      setApproved(true)
    } else {
      setDenied(true)
    }
  }, [api, filterId])

  return (
    <div className={className} style={{ height, display: 'flex', flexDirection: 'column',  minHeight: 120, backgroundColor: 'var(--dl-fill-0)' }}>
      {filterId && !approved ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', textAlign: 'center' }}>
            {uiText('ui.logViewerRequestDesc', api.pluginId, filterId)}
          </div>
          {denied ? <div style={{ fontSize: 12, color: '#f56c6c' }}>{uiText('ui.logViewerRequestDenied')}</div> : null}
          <button
            type="button"
            onClick={() => void handleApprove()}
            style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 18px', borderRadius: 6, border: '1px solid var(--primary)', background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: 13, cursor: 'pointer' }}
          >
            {uiText('ui.logViewerRequestApprove')}
          </button>
        </div>
      ) : (
        <>
      <div style={{ display: 'flex',  alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',padding: '4px 20px' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',  }}>
          {LEVEL_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setLevel(k)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 4,
                border: '1px solid transparent',
                cursor: 'pointer',
                fontSize: 12,
                background: level === k ? 'var(--foreground)' : 'transparent',
                color: level === k ? 'var(--background)' : 'var(--muted-foreground)',
                fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
              }}
            >
              <span>{k === 'all' ? uiText('ui.logViewerAll') : LEVEL_LABELS[k]}</span>
              {k !== 'all' ? (
                <span
                  style={{
                    minWidth: 16,
                    height: 16,
                    lineHeight: '16px',
                    padding: '0 4px',
                    borderRadius: 8,
                    textAlign: 'center',
                    fontSize: 11,
                    background: level === k ? 'color-mix(in oklab, var(--background) 25%, transparent)' : 'var(--secondary)',
                    color: level === k ? 'var(--background)' : LEVEL_COLORS[k],
                  }}
                >
                  {counts[k] ?? 0}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              width: 196,
              height: 28,
              padding: '0 8px',
              borderRadius: 6,
              border: '1px solid var(--input)',
              background: 'transparent',
              color: 'var(--muted-foreground)',
            }}
          >
            <SearchIcon size={14}/>
            <input
              value={keyword}
              placeholder={uiText('ui.logViewerSearch')}
              onChange={(e) => setKeyword(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--foreground)',
                fontSize: 12,
              }}
            />
            {keyword ? (
              <button
                type="button"
                aria-label={uiText('ui.logViewerClearSearch')}
                onClick={() => setKeyword('')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'inline-flex', padding: 0 }}
              >
                ×
              </button>
            ) : null}
          </div>
          <Tooltip content={uiText('ui.logViewerDownload')}>
            <button
              type="button"
              onClick={handleDownload}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--muted-foreground)' }}
            >
              <DownloadIcon size={14}/>
            </button>
          </Tooltip>
          <Tooltip content={uiText('ui.logViewerClear')}>
            <button
              type="button"
              onClick={handleClear}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--muted-foreground)' }}
            >
              <DeleteIcon size={14}/>
            </button>
          </Tooltip>
        </div>
      </div>
      
      <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid rgba(128,128,128,0.2)',}}>
        {error ? 
          <div style={{ fontSize: 12, color: '#f56c6c' }}>{uiText('ui.logViewerReadFailed')}</div> : 
          filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#909399', fontSize: 13 }}>{uiText('ui.logViewerEmpty')}</div>
          ) : (
            filtered.map((e, i) => <LogRow key={i} entry={e} />)
          )
        }
      </div>
        </>
      )}
    </div>
  )
}

export default LogViewer
