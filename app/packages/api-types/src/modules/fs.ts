/**
 * fs host-api — typed single source.
 * Real source of truth: app/src/main/api/fs.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 * Path whitelist enforcement (fs-grants) is applied uniformly by executeHostApi,
 * not by these option fields.
 */

/** Options accepted by fs.read (2nd argument; default = read text content). */
export interface FsReadOptions {
  /** Read the file as raw bytes and return base64-encoded content. Defaults to false (UTF-8 text). */
  base64?: boolean
}

/** Binary payload accepted by fs.write / fs.withLock when writing bytes (base64-encoded data). */
export interface FsWriteData {
  /** File content as a base64 string (decoded before being written). */
  base64: string
}

/**
 * Result of fs.stat: the serializable data fields of the Node fs.Stats object.
 * IPC strips prototype methods (isFile/isDirectory) and only data fields survive;
 * time fields are ms-epoch numbers (prefer mtimeMs over Date variants).
 */
export interface FsStatResult {
  dev: number
  ino: number
  mode: number
  nlink: number
  uid: number
  gid: number
  rdev: number
  /** File size in bytes. */
  size: number
  blksize: number
  blocks: number
  /** Access time, ms-epoch. */
  atimeMs: number
  /** Modification time, ms-epoch. */
  mtimeMs: number
  /** Status change time, ms-epoch. */
  ctimeMs: number
  /** Creation time, ms-epoch. */
  birthtimeMs: number
}

/** Single entry returned by fs.listDir (best-effort size/mtime when stat fails are 0). */
export interface FsListDirEntry {
  /** Entry file/dir name (basename within the listed directory). */
  name: string
  /** Whether the entry is a directory. */
  isDirectory: boolean
  /** Whether the entry is a regular file. */
  isFile: boolean
  /** File size in bytes (0 for directories or when stat failed). */
  size: number
  /** Modification time in ms-epoch (0 when stat failed). */
  mtimeMs: number
}

/** fs.listDir return type: an array of directory entries. */
export type FsListDirResult = FsListDirEntry[]

/** Result of fs.lock: the lock id that must be passed back to fs.unlock / fs.withLock. */
export interface FsLockResult {
  /** Opaque lock id; pass it to fs.unlock to release this lock. */
  lockId: string
}

/** Options accepted by fs.lock / fs.withLock (3rd argument; per-path cross-process file lock). */
export interface FsLockOptions {
  /** Lock auto-expiry in ms (guards against a dead holder). Defaults to 30000. */
  ttlMs?: number
  /** Whether to queue when the path is already locked; false throws busy immediately. Defaults to true. */
  wait?: boolean
  /** Max queue wait in ms before a TIMEOUT error. Defaults to 15000. */
  timeoutMs?: number
}

/** Single file operation executed by fs.withLock while holding the path lock. */
export type FsWithLockOperation =
  /** Read the file (UTF-8 text). */
  | { method: 'read' }
  /** Read the file metadata (same shape as fs.stat). */
  | { method: 'stat' }
  /** Write the file (string content or base64 payload). */
  | { method: 'write'; data: string | FsWriteData }
  /** Append text to the file (creates parent directories first). */
  | { method: 'append'; data: string }
  /** Delete the file/dir. */
  | { method: 'delete' }
  /** Rotate log files (SDK logger pre-write check; host-side log rotation). */
  | { method: 'rotate' }

/** fs.withLock return type: 'read'/'stat' return data, other operations resolve with undefined. */
export type FsWithLockResult = string | FsStatResult | undefined

/** Flat signature map for the fs module. */
export type FsModuleApi = {
  /**
   * Reads a file: UTF-8 text by default, or base64-encoded bytes when options.base64 is true.
   * Requires an fs-grants read whitelist entry for the path.
   */
  'fs.read'(path: string, options?: FsReadOptions): Promise<string>
  /** Returns file/dir metadata as a flat data object (throws when the path does not exist). */
  'fs.stat'(path: string): Promise<FsStatResult>
  /** Lists directory entries with a best-effort size/mtime per entry. */
  'fs.listDir'(path: string): Promise<FsListDirResult>
  /**
   * Watches a directory for changes and returns a watch id. Changes are delivered to the
   * calling plugin worker as `<pluginId>.fs-watch-event` with args [watchId, filename].
   */
  'fs.watch'(path: string): Promise<string>
  /** Stops a directory watch started by fs.watch (idempotent; unknown ids are ignored). */
  'fs.unwatch'(watchId: string): Promise<void>
  /** Creates a directory (recursive; no error when it already exists). */
  'fs.mkdir'(path: string): Promise<void>
  /** Writes a file atomically (string content or base64 payload; parent dirs are created). */
  'fs.write'(path: string, data: string | FsWriteData): Promise<void>
  /** Appends text to a file, creating parent directories first (log writes use this). */
  'fs.append'(path: string, data: string): Promise<void>
  /** Deletes a file or directory (recursive, force). Requires a write whitelist entry. */
  'fs.delete'(path: string): Promise<void>
  /**
   * Copies a directory tree. dest must be inside the host userData directory;
   * exclude filters out top-level entry names (e.g. node_modules, .git).
   */
  'fs.copyDir'(src: string, dest: string, exclude?: string[]): Promise<void>
  /** Acquires a per-path cross-process file lock (worker-only scope); returns { lockId }. */
  'fs.lock'(path: string, options?: FsLockOptions): Promise<FsLockResult>
  /** Releases a file lock previously acquired with fs.lock (idempotent on unknown lockId). */
  'fs.unlock'(path: string, lockId: string): Promise<void>
  /** Runs a single file operation while holding the path lock (worker-only scope). */
  'fs.withLock'(path: string, operation: FsWithLockOperation, options?: FsLockOptions): Promise<FsWithLockResult>
}
