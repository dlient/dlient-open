/**
 * net host-api — typed single source.
 * Real source of truth: app/src/main/api/net.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 * net.fetch / net.request go through net-grants authorization (host policy blocks
 * internal/loopback traffic and hard-denies cloud metadata endpoints).
 */

/** Request init accepted by net.fetch (serializable subset of Electron net.fetch init). */
export interface NetFetchInit {
  /** HTTP method (e.g. 'GET' / 'POST'). Defaults to 'GET'. */
  method?: string
  /** Request headers as a flat name → value map. */
  headers?: Record<string, string>
  /** Request body (only string bodies are forwarded). */
  body?: string
}

/** Options accepted by net.request (net.fetch with the url moved into the options object). */
export interface NetRequestOptions {
  /** Target URL. Required. */
  url: string
  /** HTTP method (e.g. 'GET' / 'POST'). Defaults to 'GET'. */
  method?: string
  /** Request headers as a flat name → value map. */
  headers?: Record<string, string>
  /** Request body (only string bodies are forwarded). */
  body?: string
}

/** Result of a successful net.fetch / net.request call. */
export interface NetFetchResult {
  /** Whether the response status was 2xx (mirrors fetch Response.ok). */
  ok: boolean
  /** HTTP status code. */
  status: number
  /** HTTP status text. */
  statusText: string
  /** Response headers as a flat name → value map (last value wins per header). */
  headers: Record<string, string>
  /** Response body bytes encoded as base64 (empty string when the body is empty). */
  body: string
}

/** Flat signature map for the net module. */
export type NetModuleApi = {
  /** Whether the machine has an internet connection (read-only). */
  'net.isOnline'(): Promise<boolean>
  /**
   * Performs an HTTP request (net-grants authorization; see module header). Returns the
   * full response with the body base64-encoded. User denial throws USER_DENIED.
   * The `description` argument (optional) is the authorization request copy shown in the
   * net-access permission dialog when this URL is not yet authorized (tell the user why).
   */
  'net.fetch'(url: string, init?: NetFetchInit, description?: string): Promise<NetFetchResult>
  /** Performs an HTTP request from an options object (same authorization as net.fetch; its `description` argument is likewise shown in the net-access permission dialog as the authorization reason). */
  'net.request'(options: NetRequestOptions, description?: string): Promise<NetFetchResult>
  /** Allocates a free TCP port on 127.0.0.1 (replaces worker-side node:net binding). */
  'net.getFreePort'(): Promise<number>
  /** Probes whether a local TCP port is reachable on 127.0.0.1 (800ms timeout). */
  'net.probePort'(port: number): Promise<boolean>
}
