/**
 * permission host-api — typed single source.
 * Real source of truth: app/src/main/api/permission.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Resource kind a permission targets. */
export type PermissionResourceType = 'fs' | 'net' | 'spawn'
/** fs access mode requested in a permission.request fs item. */
export type PermissionFsMode = 'read' | 'write'
/** Lifetime of a granted permission. */
export type PermissionGrantScope = 'persistent' | 'session'

/** A single granted-resource record, as returned inside permission.list / permission.plugin.list. */
export interface PermissionGrant {
  /** Resource kind of the grant (fs = path, net = URL prefix, spawn = command). */
  type: PermissionResourceType
  /** fs: absolute path; net: URL prefix; spawn: command. */
  target: string
  /** Owner plugin instance key (e.g. 'dev-tools' or 'nodejs@dev'). */
  pluginId: string
  /** fs-only access mode ('read' | 'write'); absent for net/spawn grants. */
  mode?: PermissionFsMode
  /** Whether the grant is persisted across host restarts (persistent) or session-only. */
  scope: PermissionGrantScope
  /** Epoch milliseconds when the grant was recorded. */
  grantedAt: number
}

/** A plugin's resource grants grouped by kind (market "Permissions" page / own-grants view). */
export interface PermissionGrantList {
  fs: PermissionGrant[]
  net: PermissionGrant[]
  spawn: PermissionGrant[]
}

/** One item of a permission.request batch: fs items carry path (+ optional mode), net items carry url, spawn items carry cmd. */
export interface PermissionRequestItem {
  /** Resource kind: 'fs' (also used when omitted and path is set) | 'net' | 'spawn'. net requires url; spawn requires cmd. */
  type?: PermissionResourceType
  /** fs: absolute path or alias to request (see the fs module dir-alias list). */
  path?: string
  /** net: URL to request (only honored when type is 'net'). */
  url?: string
  /** spawn: command to request (only honored when type is 'spawn'). */
  cmd?: string
  /** fs-only access mode(s): 'read' | 'write' | both; defaults to read + write when omitted. */
  mode?: PermissionFsMode | PermissionFsMode[]
}

/** Options accepted by permission.revoke (admin entry to revoke another plugin's resource grant). */
export interface PermissionRevokeOptions {
  /** Target plugin instance key. */
  pluginId?: string
  /** fs: path; net: URL prefix; spawn: command. */
  target?: string
}

/** Result of a successful permission.revoke call. */
export interface PermissionRevokeResult {
  ok: boolean
}

/** Result of permission.request: granted/denied are requested targets (denied = rejected by the user in the confirm dialog). */
export interface PermissionRequestResult {
  granted: string[]
  denied: string[]
}

/** Flat signature map for the permission module. */
export type PermissionModuleApi = {
  /** Lists the resource grants of an arbitrary plugin (admin; market "Permissions" page). */
  'permission.plugin.list'(pluginId: string): Promise<PermissionGrantList>
  /** Revokes one resource grant of a plugin by type + target (type ∈ fs | net | spawn; merged fs.revokeAccess / net.revokeUrl / auth.revokeGrant). */
  'permission.revoke'(type: PermissionResourceType, options: PermissionRevokeOptions): Promise<PermissionRevokeResult>
  /** Batch pre-authorization: lists fs/net/spawn resources once so the user can grant them in a single dialog (avoids per-call prompts at runtime). */
  'permission.request'(resources: PermissionRequestItem[], description?: string): Promise<PermissionRequestResult>
  /** Lists the current plugin's own resource grants (no argument needed; identity comes from the caller). */
  'permission.list'(): Promise<PermissionGrantList>
}
