/**
 * webview host-api — typed single source.
 * Real source of truth: app/src/main/api/webview.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Rect bounds of a webview, in DIP. */
export interface WebviewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Whitelisted webContents events the host forwards to the owning plugin worker (as `onWebContentsEvent`). */
export type WebviewEventName =
  | 'did-finish-load'
  | 'did-fail-load'
  | 'did-start-loading'
  | 'did-stop-loading'
  | 'page-title-updated'
  | 'did-navigate'
  | 'did-navigate-in-page'
  | 'will-navigate'

/** webContents methods the host allows webview.webContentsCall to invoke (method whitelist). */
export type WebviewWebContentsMethod =
  | 'loadURL'
  | 'reload'
  | 'stop'
  | 'goBack'
  | 'goForward'
  | 'getURL'
  | 'getTitle'
  | 'executeJavaScript'
  | 'setZoomLevel'
  | 'getZoomLevel'

/** Options accepted by webview.create. */
export interface WebviewCreateOptions {
  /** URL to load once the view is created. */
  src?: string
  /** Initial view bounds (0,0,0,0 when omitted — set bounds right after via webview.update). */
  bounds?: WebviewBounds
  /** WebPreferences passthrough; only 'partition' and 'userAgent' are honored, security-sensitive options (sandbox/contextIsolation/nodeIntegration) are always forced by the host. */
  webPreferences?: {
    partition?: string
    userAgent?: string
  }
  /** Whitelisted webContents events to subscribe; their payloads are forwarded to the owning plugin worker. */
  events?: WebviewEventName[]
}

/** Result of webview.create. */
export interface WebviewCreateResult {
  viewId: string
}

/** Options accepted by webview.update (re-bounds an existing view). */
export interface WebviewUpdateOptions {
  viewId: string
  bounds: WebviewBounds
}

/** Options accepted by webview.setVisible (component-level visibility override; owner visibility alignment still applies). */
export interface WebviewSetVisibleOptions {
  viewId: string
  visible: boolean
}

/** Options accepted by webview.webContentsCall (invokes a whitelisted webContents method with JSON-serializable args). */
export interface WebviewWebContentsCallOptions {
  viewId: string
  method: WebviewWebContentsMethod
  /** Arguments forwarded to the method; only JSON-serializable values survive the host round-trip. */
  args?: unknown[]
}

/** Flat signature map for the webview module. */
export type WebviewModuleApi = {
  /** Creates an embedded webview owned by the currently active plugin (visibility follows the owner-alignment rule). */
  'webview.create'(options: WebviewCreateOptions): Promise<WebviewCreateResult>
  /** Updates the bounds of an existing webview (no-op when the id is unknown). */
  'webview.update'(options: WebviewUpdateOptions): Promise<void>
  /** Destroys a webview by id (no-op when the id is unknown). */
  'webview.destroy'(viewId: string): Promise<void>
  /** Sets the component-level visibility of a webview. */
  'webview.setVisible'(options: WebviewSetVisibleOptions): Promise<void>
  /** Calls a whitelisted webContents method (navigation / title / zoom / executeJavaScript); other methods are rejected. Returns the method's result. */
  'webview.webContentsCall'(options: WebviewWebContentsCallOptions): Promise<unknown>
  /** Shows the caller plugin's webviews again; when views is given only those exact ids are restored (pair with webview.hideWebviewByPlugin's result). */
  'webview.showWebviewByPlugin'(views?: string[]): Promise<void>
  /** Hides all of the caller plugin's webviews and returns the hidden view ids (pass them back to webview.showWebviewByPlugin for exact restore). */
  'webview.hideWebviewByPlugin'(): Promise<string[]>
}
