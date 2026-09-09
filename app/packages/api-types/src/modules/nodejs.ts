/**
 * nodejs host-api — typed single source (open-source built-in Node.js runtime).
 * Real source of truth: app/src/main/api/nodejs.ts (handlers delegate to app/src/main/nodejs.ts).
 * The plugin-facing channel replaces the closed-version cross-plugin invoke to the `nodejs` plugin:
 *  - `rpc.nodejs.resolveRuntime(opts)`  → old `plugin.invoke('nodejs','nodejs.resolveRuntime',[opts])`
 *  - `rpc.nodejs.install(version?)`     → old `plugin.invoke('nodejs','nodejs.install',[version])`
 * All docs are English; keep in sync with the main-process api table.
 */

/** Result of a local Node.js probe (PATH / well-known install locations). */
export interface NodejsLocalResult {
  /** Whether a node binary was found and answered `--version`. */
  hasNode: boolean
  /** Detected version string (e.g. "v22.11.0"). Present when hasNode. */
  version?: string
  /** 'node' when resolved via PATH, otherwise the absolute binary path. Present when hasNode. */
  path?: string
  /** Whether the detected version satisfies the declared requirement (missing requirement = true). */
  satisfies?: boolean
}

/** Result of the bundled Node.js probe (`<userData>/plugin-data/nodejs`). */
export interface NodejsBundledResult {
  /** Whether the bundled runtime is installed and answers `--version`. */
  ready: boolean
  /** Detected version string. Present when ready. */
  version?: string
  /** Absolute path to the bundled binary. Present when ready. */
  path?: string
  /** Whether the version satisfies the declared requirement (missing requirement = true). */
  satisfies?: boolean
}

/** Runtime resolved for execution (bundled preferred, then PATH). */
export interface NodejsRuntimeResult {
  /** Absolute path to the node binary (or 'node' for a PATH resolution). Missing when source = 'none'. */
  node?: string
  /** npm launcher to run (same as node for bundled; 'npm' for PATH). Missing when source = 'none'. */
  npm?: string
  /** Absolute npm-cli.js for the bundled runtime (run with node). Missing for PATH resolution. */
  npmCli?: string
  /** Where the runtime came from: bundled (built-in) / path (local) / none (unavailable). */
  source: 'bundled' | 'path' | 'none'
  /** Resolved version string. Present when source !== 'none'. */
  version?: string
}

/** Result of a bundled runtime install (single-flight, downloads to `<userData>/plugin-data/nodejs`). */
export interface NodejsInstallResult {
  /** Whether the install completed and the binary answers `--version`. */
  ok: boolean
  /** Installed version string. Present when ok. */
  version?: string
  /** Absolute path to the installed binary. Present when ok. */
  path?: string
  /** Failure message (english). Present when !ok. */
  error?: string
}

/** Flat signature map for the nodejs module. */
export type NodejsModuleApi = {
  /** Probes a local Node.js runtime (PATH / well-known install locations). */
  'nodejs.checkLocal'(opts?: { version?: string }): Promise<NodejsLocalResult>
  /** Probes the bundled Node.js runtime (`<userData>/plugin-data/nodejs`). */
  'nodejs.checkBundled'(opts?: { version?: string }): Promise<NodejsBundledResult>
  /** Resolves the runtime to execute with (bundled preferred, then local PATH). */
  'nodejs.resolveRuntime'(opts?: { version?: string }): Promise<NodejsRuntimeResult>
  /** Installs the bundled LTS runtime (single-flight; version optional). */
  'nodejs.install'(version?: string): Promise<NodejsInstallResult>
}
