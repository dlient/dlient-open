/**
 * os host-api — typed single source.
 * Real source of truth: app/src/main/api/os.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Flat signature map for the os module. */
export type OsModuleApi = {
  /** Opens an external URL with the system default app (http/https/mailto/...). System scope; dangerous. */
  'os.openExternal'(url: string): Promise<void>
  /** Reveals a file or directory in the system file manager. System scope. */
  'os.showItemInFolder'(path: string): Promise<void>
}
