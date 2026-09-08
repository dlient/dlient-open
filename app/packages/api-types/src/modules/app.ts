/**
 * app host-api — typed single source.
 * Real source of truth: app/src/main/api/app.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Whitelisted names accepted by app.getPath. 'userData' resolves to the plugin-isolated dir, 'plugins' to the host plugins dir. */
export type AppPathName =
  | 'userData'
  | 'plugins'
  | 'home'
  | 'temp'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos'
  | 'recent'

/** Options accepted by app.notify (worker scope; a '__render' receiver is stripped with a security warning). */
export interface AppNotifyOptions {
  /** Event name delivered to matching listeners. Required. */
  event: string
  /** Target receiver role/plugin ids; 'all' broadcasts to every listener. Defaults to []. */
  receiver?: string[]
  /** Arbitrary serializable payload attached to the event. */
  data?: unknown
  /** Deduplication/sequence id. Defaults to `${event}-${Date.now()}`. */
  event_id?: string
}

/** Result of app.notify: constant success marker. */
export interface AppNotifyResult {
  ok: true
}

/** Options accepted by app.shortcut.register. */
export interface AppShortcutRegisterOptions {
  /** Local shortcut id reported back to the plugin when the accelerator fires. Required. */
  id: string
  /** Global accelerator in Electron Accelerator syntax. Required; registration throws when the key is busy. */
  accelerator: string
  /** Reserved action hint carried by the registration. */
  action?: string
}

/** One native context-menu item template (only safe display fields are honored; click callbacks are injected by the host). */
export interface AppMenuItemSpec {
  /** Identifier returned when the item is clicked; optional for separators. */
  id?: string
  /** Display label. */
  label?: string
  /** Item kind. Defaults to 'normal'; 'separator' ignores all other fields. */
  type?: 'normal' | 'separator' | 'checkbox'
  /** Whether the item is enabled. Defaults to true. */
  enabled?: boolean
  /** Initial checked state for 'checkbox' items. Defaults to false. */
  checked?: boolean
}

/** Options accepted by app.menu.popup. */
export interface AppMenuPopupOptions {
  /** Menu item templates. Must be a non-empty array. */
  items: AppMenuItemSpec[]
  /** Optional popup x position (screen DIP). */
  x?: number
  /** Optional popup y position (screen DIP). */
  y?: number
}

/** Result of app.menu.popup: the clicked item id, or null when dismissed (blank area / ESC). */
export type AppMenuPopupResult = string | null

/** Options accepted by app.createNativeHost (usually called internally by the SDK's createNativeHost helper). */
export interface CreateNativeHostOptions {
  /** Entry file name located inside the plugin dist dir; path traversal is rejected. Required. */
  fileName: string
  /** Absolute path to the Node executable used to run the entry. Required. */
  node: string
}

/** Options accepted by app.createNativeClient (same shape as hosted child spawn options). */
export interface CreateNativeClientOptions {
  /** Command to spawn. Required (missing cmd fails the call). */
  cmd: string
  /** Command-line arguments. Defaults to []. */
  args?: string[]
  /** Working directory of the child process. */
  cwd?: string
  /** Extra environment variables (merged over a stripped base env). */
  env?: Record<string, string>
  /** Detach the child process. A platform default is applied when omitted. */
  detached?: boolean
  /** Human-readable purpose shown on the spawn authorization prompt. */
  description?: string
}

/** Cross-process reference to a host-managed child process (returned by createNativeHost / createNativeClient). */
export interface NativeSpawnRef {
  /** Host-side handle id (used by disposeNativeClient and the SDK child handles). */
  handleId: string
  /** Process id (diagnostics/display). */
  pid: number
}

/** Kill/dispose outcome of app.disposeNativeClient (idempotent; already-exited handles report reason). */
export interface NativeDisposeResult {
  ok: boolean
  reason?: string
}

/** Flat signature map for the app module. */
export type AppModuleApi = {
  /** Host app version. */
  'app.getVersion'(): Promise<string>
  /** Resolves a whitelisted path; 'userData' returns the plugin-isolated data dir, 'plugins' the host plugins dir. */
  'app.getPath'(name: AppPathName): Promise<string>
  /** Whether the host currently has a focused window. */
  'app.isActive'(): Promise<boolean>
  /** Whether all host windows are hidden. */
  'app.isHidden'(): Promise<boolean>
  /** Host app name. */
  'app.getName'(): Promise<string>
  /** Host app locale. */
  'app.getLocale'(): Promise<string>
  /** Host app locale country code. */
  'app.getLocaleCountryCode'(): Promise<string>
  /** Host system locale. */
  'app.getSystemLocale'(): Promise<string>
  /** Host preferred system languages (most to least preferred). */
  'app.getPreferredSystemLanguages'(): Promise<string[]>
  /** Broadcasts an event to renderer receivers; a '__render' receiver is stripped and warned. Worker scope. */
  'app.notify'(options: AppNotifyOptions): Promise<AppNotifyResult>
  /** Registers or removes the OS auto-launch entry for the host. Worker scope; dangerous. */
  'app.setAutoLaunch'(enabled: boolean): Promise<void>
  /** Forwards a global setting change ('theme' | 'language') to all host windows. Worker scope. */
  'app.event'(channel: 'theme' | 'language', value: string): Promise<void>
  /** Starts a host-managed native Node process running an entry inside the plugin dist. Worker scope; dangerous. */
  'app.createNativeHost'(options: CreateNativeHostOptions): Promise<NativeSpawnRef>
  /** Spawns a host-managed child process and returns its cross-process handle. Worker scope; dangerous. */
  'app.createNativeClient'(options: CreateNativeClientOptions): Promise<NativeSpawnRef>
  /** Kills and disposes a hosted child by handle id (idempotent). Worker scope; dangerous. */
  'app.disposeNativeClient'(handleId: string): Promise<NativeDisposeResult>
  /** Closes the main window (frameless title-bar control). Worker scope. */
  'app.window.close'(): Promise<void>
  /** Focuses the main window. Worker scope. */
  'app.window.focus'(): Promise<void>
  /** Blurs the main window. Worker scope. */
  'app.window.blur'(): Promise<void>
  /** Shows the main window. Worker scope. */
  'app.window.show'(): Promise<void>
  /** Hides the main window. Worker scope. */
  'app.window.hide'(): Promise<void>
  /** Maximizes the main window. Worker scope. */
  'app.window.maximize'(): Promise<void>
  /** Restores the main window from maximized. Worker scope. */
  'app.window.unmaximize'(): Promise<void>
  /** Minimizes the main window. Worker scope. */
  'app.window.minimize'(): Promise<void>
  /** Restores the main window from minimized. Worker scope. */
  'app.window.restore'(): Promise<void>
  /** Whether the main window is maximized. Worker scope. */
  'app.window.isMaximized'(): Promise<boolean>
  /** Sets the main window full screen. Worker scope. */
  'app.window.setFullScreen'(flag: boolean): Promise<void>
  /** Reads a JSON data file from the plugin-isolated data dir; resolves null when missing or invalid. */
  'app.data.read'(file: string): Promise<unknown>
  /** Atomically writes a JSON data file under the plugin-isolated data dir (file-locked). */
  'app.data.write'(file: string, json: unknown): Promise<void>
  /** Encrypts a string with a plugin-scoped key (AES-256-GCM). */
  'app.crypt.encrypt'(plain: string): Promise<string>
  /** Decrypts a plugin-scoped ciphertext (base64 input). */
  'app.crypt.decrypt'(value: string): Promise<string>
  /** Registers a global shortcut bound to a plugin action id; a busy accelerator throws INVALID. Worker scope; dangerous. */
  'app.shortcut.register'(options: AppShortcutRegisterOptions): Promise<void>
  /** Unregisters a global shortcut by its accelerator. Worker scope; dangerous. */
  'app.shortcut.unregister'(accelerator: string): Promise<void>
  /** Pops up a native context menu at the cursor (or given x/y); resolves with the clicked item id or null. Worker scope. */
  'app.menu.popup'(options: AppMenuPopupOptions): Promise<AppMenuPopupResult>
}
