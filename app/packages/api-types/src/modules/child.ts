/**
 * child host-api — typed single source.
 * Real source of truth: app/src/main/api/child.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** Options accepted by child.execFile (one-shot capture of a single command; shares the spawn option shape). */
export interface ChildExecFileOptions extends SpawnHostedOptions {
  /** Kill the command if it does not finish within this many milliseconds. */
  timeout?: number
}

/** Streamed child-process event callbacks delivered by the host over the child-event channel. */
export interface ChildEventHandlers {
  /** Streamed stdout chunk (one callback at a time). */
  onStdout?: (data: string) => void
  /** Streamed stderr chunk (one callback at a time). */
  onStderr?: (data: string) => void
  /** Exit notification: natural exit or killed. */
  onExit?: (info: { code: number | null; signal?: string; reason: 'exited' | 'killed' }) => void
  /** Spawn failure (e.g. command not found). */
  onError?: (err: Error) => void
}

/**
 * Handle returned by child.spawn (SDK shape — identical on the worker `rpc.child.spawn`
 * surface). The host stores the underlying process as an opaque handle ref; the SDK performs
 * the child-subscribe handshake so stdout/stderr/exit stream back to these callbacks, and
 * kill/stdin go through the child-control message channel.
 */
export interface ChildHandle {
  /** Host-side handle id. */
  handleId: string
  /** Read-only process id (diagnostics / display). */
  pid: number
  /** Idempotent: kills the process tree and unregisters; no-op once exited. */
  kill(): Promise<void>
  /** Streamed stdout (child-event push). One callback at a time. */
  onStdout(cb: (data: string) => void): void
  /** Streamed stderr (child-event push). One callback at a time. */
  onStderr(cb: (data: string) => void): void
  /** Exit event (child-event push; natural exit or killed). */
  onExit(cb: (info: { code: number | null; signal?: string; reason: 'exited' | 'killed' }) => void): void
  /** Spawn failure event (child-event push; e.g. command not found). */
  onError(cb: (err: Error) => void): void
  /** Writes stdin (child-control write; used by the native-host RPC bridge). */
  write(chunk: string): Promise<void>
  /** Ends stdin (child-control end; graceful close signal). */
  end(): Promise<void>
}

/** Options accepted by child.spawn as exposed by the SDK (same shape as ChildSpawnOptions). */
export interface SpawnHostedOptions {
  /** Command to run: absolute path, or executable name resolved through a stripped PATH. Required. */
  cmd: string
  /** Command-line arguments. Defaults to []. */
  args?: string[]
  /** Working directory of the child process. */
  cwd?: string
  /** Extra environment variables merged over the stripped base env (PATH/HOME). */
  env?: Record<string, string>
  /** Whether to spawn detached. Defaults to true except on Windows. */
  detached?: boolean
  /** Human-readable purpose shown in the spawn-confirmation dialog when the command is not pre-authorized. */
  description?: string
}

/** Result of child.execFile: captured stdout/stderr and the numeric exit code. */
export interface ChildExecFileResult {
  stdout: string
  stderr: string
  /** 0 on success; the error code on failure; -1 when no numeric code was reported. */
  code: number
}

/** Flat signature map for the child module. */
export type ChildModuleApi = {
  /**
   * Spawns a subprocess through the host (command whitelist + spawn-confirm authorization)
   * and returns a ChildHandle — kill/stdin and streamed stdout/stderr/exit/error events are
   * delivered over message channels via the SDK subscription handshake.
   * (Internally the host keeps an opaque ref of shape { handleId, pid }.)
   */
  'child.spawn'(options: SpawnHostedOptions): Promise<ChildHandle>
  /** Runs a command once and captures its output (probe-style usage, e.g. `node --version`). Authorization is the same as child.spawn. */
  'child.execFile'(options: ChildExecFileOptions): Promise<ChildExecFileResult>
}
