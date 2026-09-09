/**
 * plugin host-api — typed single source.
 * Real source of truth: app/src/main/api/plugin.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Install source of a plugin. */
export type PluginSource = 'market' | 'local' | 'dev'
/** Plugin kind (what the plugin runs / ships). */
export type PluginType = 'full' | 'worker' | 'ui' | 'app'
/** Call-channel gate of a host api (plugin.capabilities entries). */
export type PluginCapabilityScope = 'all' | 'worker' | 'ui' | 'system'
/** Install-risk label of a host api (plugin.capabilities entries). */
export type PluginCapabilityLevel = 'default' | 'warn' | 'dangerous'

/** One capability entry returned by plugin.capabilities (full api-table metadata). */
export interface PluginCapability {
  /** Full dotted api key (also the manifest.permissions declaration value). */
  key: string
  /** Localized human-readable description. */
  description: { 'zh-CN': string; 'en-US': string }
  /** Who may invoke the api. */
  scope: PluginCapabilityScope
  /** Risk label shown on the market permissions page. */
  level: PluginCapabilityLevel
}

/** An installed-plugin record, as returned by plugin.scanInstalled / plugin.system. */
export interface PluginInstalledEntry {
  id: string
  name: string
  version: string
  /** Whether the plugin worker is enabled. */
  enabled: boolean
  source: PluginSource
  type: PluginType
  /** True for system plugins (cannot be uninstalled). */
  system?: boolean
  /** Icon (relative path inside the plugin root). */
  icon?: string
  /** Plugin organization ('@xxx'); absent = no organization. */
  organization?: string
  /** Plugin root directory (absolute). */
  path: string
  /** Epoch milliseconds when it was installed. */
  installedAt: number
  /** Epoch milliseconds of the last launch. */
  lastUsedAt?: number
}

/** A registry entry payload accepted by plugin.registry.report (matches the host installed.json entry shape). */
export interface PluginRegistryEntry {
  id: string
  name: string
  version: string
  type: PluginType
  source: PluginSource
  system?: boolean
  icon?: string
  /** dist subdirectory relative to the plugin root (defaults to 'dist'). */
  dist?: string
  /** Plugin root directory (absolute). */
  path: string
  /** Epoch milliseconds when the entry was added. */
  addedAt: number
}

/** A dev-plugin entry reported through plugin.dev.sync (dev runtime → host; source is always 'dev'). */
export interface PluginDevEntry {
  id: string
  name: string
  /** Plugin root directory (absolute; contains package.json — dist is not copied). */
  path: string
  /** dist subdirectory relative to the plugin root (manifest.dist ?? 'dist'). */
  dist: string
  version?: string
  type?: PluginType
  system?: boolean
  icon?: string
  /** Epoch milliseconds when the entry was added to the dev list. */
  addedAt: number
}

/** Result of plugin.dev.getDirInfo: where the dev plugin actually lives. */
export interface PluginDevDirInfo {
  /** Plugin root directory (absolute). */
  dir: string
  /** dist subdirectory relative to the plugin root. */
  dist: string
}

/** Result of plugin.dev.startWatcher / plugin.dev.stopWatcher. */
export interface PluginDevWatcherResult {
  ok: boolean
  /** startWatcher only: failure reason (localized object for UI display, plain string fallback). */
  error?: string | { enUS: string; zhCN: string }
}

/** Options accepted by plugin.dev.readLogs (incremental tail read of the target plugin's main.log). */
export interface PluginLogReadOptions {
  /** Byte offset to continue reading from (use the previous result's offset). */
  offset?: number
  /** Maximum bytes to read in one call (defaults to 512 KiB). */
  maxBytes?: number
}

/** Result of plugin.dev.readLogs. */
export interface PluginLogReadResult {
  /** Complete log lines read. */
  lines: string[]
  /** Next byte offset to continue from. */
  offset: number
  /** True when reading restarted from the log tail (rotation or an oversized gap). */
  reset: boolean
  /** True when output was cut at the read limit. */
  truncated: boolean
}

/** Result of plugin.logs.subscribe. */
export interface PluginLogSubscribeResult {
  /** Subscription id (pass to plugin.logs.unsubscribe). */
  subId: string
}

/** Result of plugin.installLocal. */
export interface PluginInstallLocalResult {
  ok: boolean
  /** Installed plugin id (from the manifest dlient.id). */
  id: string
  /** Target install directory (absolute). */
  path: string
}

/** Request for plugin.install: install a plugin (with its preInstall dependencies) from any supported source. */
export interface PluginInstallRequest {
  /**
   * Source kind. Auto-detected from `source` when omitted:
   * http(s) ending at github.com → github; other http(s) → url; otherwise npm.
   * `file` must be given explicitly to install from a local .dlient path.
   */
  kind?: 'file' | 'npm' | 'github' | 'url'
  /**
   * npm only: the npm package name to fetch (defaults to parsing `<pkg>@<spec>` from `source`).
   * When `id` is provided, `source` is treated as the version spec (e.g. "0.5.1" / "latest").
   */
  id?: string
  /** .dlient file path (kind=file) / github repo URL / .dlient URL / npm reference (`pkg` or `pkg@spec`) */
  source: string
}

/** Result of plugin.install. */
export interface PluginInstallResult {
  ok: boolean
  /** Installed plugin id. Present when ok. */
  id?: string
  /** Localized plugin name. Present when ok. */
  name?: string
  /** Installed version. Present when ok. */
  version?: string
  /** Failure message (english). Present when !ok. */
  error?: string
}

/** Flat signature map for the plugin module. */
export type PluginModuleApi = {
  /** Lists the full host api-table metadata (keys + scope/level/localized descriptions). System plugins only. */
  'plugin.capabilities'(): Promise<PluginCapability[]>
  /** Reports the complete installed registry from the market worker; the host refreshes its cache from it. System plugins only. */
  'plugin.registry.report'(entries: PluginRegistryEntry[]): Promise<{ ok: boolean }>
  /** Starts a plugin worker (already running → no-op). System plugins only. */
  'plugin.start'(pluginId: string): Promise<void>
  /** Stops a plugin worker (also cleans up its owned WebContentsView). System plugins only. */
  'plugin.stop'(pluginId: string): Promise<void>
  /** Lists the installed system plugins. */
  'plugin.system'(): Promise<PluginInstalledEntry[]>
  /** Scans the installed plugins (registry + directory fallback) into a unified list. Worker-scope primitive for dev-tools/market. */
  'plugin.scanInstalled'(): Promise<PluginInstalledEntry[]>
  /** Lists all running-instance runtime states (formal + dev records). Shape is host-internal; consumed by dev-tools. */
  'plugin.runtimeList'(): Promise<unknown[]>
  /** Imports a local plugin (copy artifacts + patch manifest + register + report + start). Worker-scope primitive for dev-tools. */
  'plugin.installLocal'(dir: string): Promise<PluginInstallLocalResult>
  /** Installs a plugin package (deep-installs its preInstall deps) from a .dlient file path / npm / github release / URL. Worker-scope primitive. */
  'plugin.install'(request: PluginInstallRequest): Promise<PluginInstallResult>
  /** Whether a plugin worker is currently running. */
  'plugin.isRunning'(pluginId: string): Promise<boolean>
  /** Post-uninstall cleanup of a plugin (grants + change broadcast). System plugins only. */
  'plugin.cleanupUninstall'(pluginId: string): Promise<void>
  /** Opens a directory picker for selecting a dev plugin dir; resolves null when cancelled. */
  'plugin.dev.selectDirectory'(): Promise<string | null>
  /** Resolves the dev directory info (dir/dist) of a dev plugin id; null when unknown. */
  'plugin.dev.getDirInfo'(pluginId: string): Promise<PluginDevDirInfo | null>
  /** Dev runtime reports its full dev-plugin list to the host (cache update; no fs grants implied). */
  'plugin.dev.sync'(entries: PluginDevEntry[]): Promise<void>
  /** Starts the hot-reload watcher for a dev plugin (call after a build completes). */
  'plugin.dev.startWatcher'(pluginId: string): Promise<PluginDevWatcherResult>
  /** Stops the hot-reload watcher of a dev plugin (during build/refresh). */
  'plugin.dev.stopWatcher'(pluginId: string): Promise<PluginDevWatcherResult>
  /** Re-forks the dev-instance worker of a dev plugin (last step of the refresh flow). */
  'plugin.dev.startDevWorker'(pluginId: string): Promise<void>
  /** Stops the dev-instance worker of a dev plugin (first step of the refresh flow). */
  'plugin.dev.stopDevWorker'(pluginId: string): Promise<void>
  /** Whether the dev instance worker's direct port is ready (running may precede port-ready). */
  'plugin.dev.isPortReady'(pluginId: string): Promise<boolean>
  /** Reads the buffered tail of a target plugin's log (incremental byte-offset reads). */
  'plugin.dev.readLogs'(pluginId: string, options?: PluginLogReadOptions): Promise<PluginLogReadResult>
  /** Clears the target plugin's runtime log file (also resets the incremental half-line cache). */
  'plugin.dev.clearLogs'(pluginId: string): Promise<void>
  /** Compatibility with legacy hosts: lists dev plugins (hosts without the dev runtime reject at runtime). */
  'plugin.dev.list'(): Promise<unknown>
  /** Compatibility with legacy hosts: removes a dev plugin by id (hosts without the dev runtime reject at runtime). */
  'plugin.dev.remove'(pluginId: string): Promise<unknown>
  /** Subscribes the caller to a target plugin's log lines (host pushes each line to the caller as `dev-tools.__onPluginLog`). */
  'plugin.logs.subscribe'(pluginId: string): Promise<PluginLogSubscribeResult>
  /** Unsubscribes a log subscription (subId from plugin.logs.subscribe). */
  'plugin.logs.unsubscribe'(pluginId: string, subId: string): Promise<boolean>
  /** Sets the active content-area plugin (was webview.setActivePlugin); null clears it. */
  'plugin.setActive'(pluginId: string | null): Promise<void>
}
