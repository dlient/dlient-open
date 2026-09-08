/**
 * screen host-api — typed single source.
 * Real source of truth: app/src/main/api/screen.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/** A 2D point in DIP or screen coordinates (Electron Point serialized). */
export interface ScreenPoint {
  x: number
  y: number
}

/** A 2D size in DIP (Electron Size serialized). */
export interface ScreenSize {
  width: number
  height: number
}

/** An axis-aligned rectangle in DIP or screen coordinates (Electron Rectangle serialized). */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** A display snapshot as returned by the screen module (Electron Display serialized as pure data). */
export interface ScreenDisplay {
  /** Unique display identifier. */
  id: number
  /** User-friendly display label. */
  label: string
  /** Display bounds in DIP. */
  bounds: ScreenRect
  /** Work-area bounds (taskbar excluded) in DIP. */
  workArea: ScreenRect
  /** Display size in DIP. */
  size: ScreenSize
  /** Work-area size in DIP. */
  workAreaSize: ScreenSize
  /** DIP scale factor (e.g. 1 for 100%, 2 for 200%). */
  scaleFactor: number
  /** Display rotation in degrees (0 / 90 / 180 / 270). */
  rotation: number
  /** Whether this is an internal (built-in) display. */
  internal: boolean
  /** Touch support capability reported by the OS. */
  touchSupport: 'available' | 'unavailable' | 'unknown'
  /** Whether the display is monochrome. */
  monochrome: boolean
  /** Accelerometer support capability reported by the OS. */
  accelerometerSupport: 'available' | 'unavailable' | 'unknown'
  /** Display color space (e.g. 'srgb'; Windows only). */
  colorSpace: string
  /** Number of bits per pixel. */
  colorDepth: number
  /** Number of bits per color component. */
  depthPerComponent: number
  /** Display refresh rate in Hz. */
  displayFrequency: number
}

/** Flat signature map for the screen module. */
export type ScreenModuleApi = {
  /** Current absolute cursor position in DIP. */
  'screen.getCursorScreenPoint'(): Promise<ScreenPoint>
  /** Info of the primary display. */
  'screen.getPrimaryDisplay'(): Promise<ScreenDisplay>
  /** Info of all currently available displays. */
  'screen.getAllDisplays'(): Promise<ScreenDisplay[]>
  /** The display nearest the given point. */
  'screen.getDisplayNearestPoint'(point: ScreenPoint): Promise<ScreenDisplay>
  /** The display that most intersects the given rectangle. */
  'screen.getDisplayMatching'(rect: ScreenRect): Promise<ScreenDisplay>
  /** Converts a physical screen point to a DIP point (Windows / Linux). */
  'screen.screenToDipPoint'(point: ScreenPoint): Promise<ScreenPoint>
  /** Converts a DIP point to a physical screen point (Windows / Linux). */
  'screen.dipToScreenPoint'(point: ScreenPoint): Promise<ScreenPoint>
  /**
   * Converts a physical screen rect to a DIP rect (Windows).
   * The window argument is not serializable over the host api — always pass null.
   */
  'screen.screenToDipRect'(window: null, rect: ScreenRect): Promise<ScreenRect>
  /**
   * Converts a DIP rect to a physical screen rect (Windows).
   * The window argument is not serializable over the host api — always pass null.
   */
  'screen.dipToScreenRect'(window: null, rect: ScreenRect): Promise<ScreenRect>
}
