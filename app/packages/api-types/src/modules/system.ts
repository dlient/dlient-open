/**
 * system host-api — typed single source.
 * Real source of truth: app/src/main/api/system.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Idle states reported by system.getIdleState (Electron powerMonitor). */
export type SystemIdleState = 'active' | 'idle' | 'locked' | 'unknown'

/** Flat signature map for the system module. */
export type SystemModuleApi = {
  /** System idle state; the system is 'idle' after thresholdSeconds of inactivity. Defaults to 5 seconds. */
  'system.getIdleState'(thresholdSeconds?: number): Promise<SystemIdleState>
  /** Enables/disables OS theme following; while enabled, OS theme changes are forwarded to the renderer. */
  'system.listenNativeTheme'(enabled: boolean): Promise<void>
}
