/**
 * dialog host-api — typed single source.
 * Real source of truth: app/src/main/api/dialog.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 * All methods are async (the *Sync Electron variants are intentionally not exposed);
 * the window argument is not serializable and is omitted — only options are passed.
 */

/** Permission tokens accepted by fs.showOpenDialog to auto-grant file access for selected paths. */
export type DialogFsPermission = 'fs.read' | 'fs.write'

/** Options accepted by dialog.showMessageBox (serializable subset of Electron MessageBoxOptions). */
export interface DialogShowMessageBoxOptions {
  /** Dialog title. */
  title?: string
  /** Message box type controlling the icon and default sound. */
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  /** Main message text. Required. */
  message: string
  /** Extra detail text shown under the message. */
  detail?: string
  /** Labels of the buttons, in order. Defaults to a single "OK" button. */
  buttons?: string[]
  /** Index of the button activated when Enter is pressed. Defaults to 0. */
  defaultId?: number
  /** Index of the button activated when Esc is pressed. */
  cancelId?: number
  /** Label of the confirmation checkbox. */
  checkboxLabel?: string
  /** Initial checked state of the confirmation checkbox. Defaults to false. */
  checkboxChecked?: boolean
  /** Whether to apply the Windows button ordering heuristic. Defaults to false. */
  noLink?: boolean
}

/** Result of a successful dialog.showMessageBox call. */
export interface DialogShowMessageBoxResult {
  /** Index of the clicked button (matches options.buttons order). */
  response: number
  /** Whether the confirmation checkbox was checked (false when no checkboxLabel is set). */
  checkboxChecked: boolean
}

/** Options accepted by dialog.showOpenDialog (serializable subset of Electron OpenDialogOptions). */
export interface DialogShowOpenOptions {
  /** Dialog title. */
  title?: string
  /** Initial path shown by the dialog. */
  defaultPath?: string
  /** Custom label for the confirm button. */
  buttonLabel?: string
  /** File-type filters shown in the dialog. */
  filters?: { name: string; extensions: string[] }[]
  /** Dialog behaviour flags. */
  properties?: (
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  )[]
  /** Informational text shown above the file list. */
  message?: string
}

/** File access granted for the paths picked in dialog.showOpenDialog. */
export interface DialogFsGrant {
  /** Paths granted for fs.read (mirrors permissions containing 'fs.read'). */
  read: string[]
  /** Paths granted for fs.write (mirrors permissions containing 'fs.write'). */
  write: string[]
}

/** Result of a successful dialog.showOpenDialog call (cancel/denial throw instead). */
export interface DialogShowOpenResult {
  /** Selected paths, realpath-resolved so they match later fs.* whitelist checks. */
  filePaths: string[]
  /** Granted file access per permission requested (empty arrays for pure-select calls). */
  granted: DialogFsGrant
}

/** Options accepted by dialog.showSaveDialog (serializable subset of Electron SaveDialogOptions). */
export interface DialogShowSaveOptions {
  /** Dialog title. */
  title?: string
  /** Initial path shown by the dialog. */
  defaultPath?: string
  /** Custom label for the confirm button. */
  buttonLabel?: string
  /** File-type filters shown in the dialog. */
  filters?: { name: string; extensions: string[] }[]
  /** Custom label for the filename text field. */
  nameFieldLabel?: string
  /** Dialog behaviour flags. */
  properties?: ('showHiddenFiles' | 'createDirectory' | 'treatPackageAsDirectory' | 'dontAddToRecent' | 'showOverwriteConfirmation')[]
  /** Informational text shown above the file list. */
  message?: string
}

/** Result of a successful dialog.showSaveDialog call (cancel throws DIALOG_CANCELED instead). */
export interface DialogShowSaveResult {
  /** The chosen path, realpath-resolved; a temp write grant is registered for it. */
  filePath: string
}

/** Flat signature map for the dialog module. */
export type DialogModuleApi = {
  /** Shows a native message box and resolves with the clicked button index. */
  'dialog.showMessageBox'(options: DialogShowMessageBoxOptions): Promise<DialogShowMessageBoxResult>
  /**
   * Shows an open/file-picker dialog. permissions requests fs access for the selected paths
   * (authorization prompt + grant); when omitted (legacy options-only call) it is a pure
   * selection without granting. Cancel or user denial throws DIALOG_CANCELED / USER_DENIED.
   * The `description` argument (optional) is the authorization request copy shown in the
   * fs-access permission dialog when the picked paths are not yet authorized.
   */
  'dialog.showOpenDialog'(
    permissions: DialogFsPermission[],
    options: DialogShowOpenOptions,
    description?: string,
  ): Promise<DialogShowOpenResult>
  /**
   * Shows a save dialog. The chosen path is written a temp write grant (intent is explicit,
   * so no confirmation prompt is shown). Cancel throws DIALOG_CANCELED.
   */
  'dialog.showSaveDialog'(options: DialogShowSaveOptions): Promise<DialogShowSaveResult>
}
