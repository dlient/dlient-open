/**
 * i18n host-api — typed single source.
 * Real source of truth: app/src/main/api/i18n.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Host UI language codes (worker query result of i18n.getLocale). */
export type I18nLocale = 'zh-CN' | 'en-US'

/** Flat signature map for the i18n module. */
export type I18nModuleApi = {
  /** Host current UI language ('zh-CN' / 'en-US'). */
  'i18n.getLocale'(): Promise<I18nLocale>
}
