/**
 * powerSaveBlocker host-api — typed single source.
 * Real source of truth: app/src/main/api/power-save.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Blocker types accepted by powerSaveBlocker.start. */
export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep'

/** Flat signature map for the powerSaveBlocker module. */
export type PowerSaveModuleApi = {
  /** Starts blocking the system from entering low-power mode; resolves with the blocker id. Worker scope. */
  'powerSaveBlocker.start'(type: PowerSaveBlockerType): Promise<number>
  /** Stops the blocker with the given id. Worker scope. */
  'powerSaveBlocker.stop'(id: number): Promise<void>
  /** Whether the blocker with the given id is still active. Worker scope. */
  'powerSaveBlocker.isStarted'(id: number): Promise<boolean>
}
