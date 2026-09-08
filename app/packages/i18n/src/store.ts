import type { Locale, ResourceBundle, Resources } from './types'

const STORAGE_KEY = 'dlient-locale'

interface Snapshot {
  locale: Locale
  resources: Resources
}

class I18nStore {
  private locale: Locale
  private resources: Resources = {}
  private snapshot: Snapshot
  private listeners = new Set<() => void>()

  constructor() {
    this.locale = this.readStorage()
    this.snapshot = { locale: this.locale, resources: this.resources }
  }

  private readStorage(): Locale {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'zh-CN' || saved === 'en-US') return saved
    }
    return 'zh-CN'
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): Snapshot => this.snapshot

  getLocale = () => this.locale

  setLocale(locale: Locale) {
    this.locale = locale
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale)
    this.commit()
  }

  addResourceBundle(ns: string, res: ResourceBundle) {
    this.resources = { ...this.resources, [ns]: res }
    this.commit()
  }

  removeResourceBundle(ns: string) {
    if (!(ns in this.resources)) return
    const next = { ...this.resources }
    delete next[ns]
    this.resources = next
    this.commit()
  }

  private commit() {
    this.snapshot = { locale: this.locale, resources: this.resources }
    this.emit()
  }

  private emit() {
    for (const cb of this.listeners) cb()
  }
}

export const store = new I18nStore()

export function addResourceBundle(ns: string, res: ResourceBundle) {
  store.addResourceBundle(ns, res)
}

export function removeResourceBundle(ns: string) {
  store.removeResourceBundle(ns)
}
