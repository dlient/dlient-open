/**
 * clipboard host-api — typed single source.
 * Real source of truth: app/src/main/api/clipboard.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 * Reading methods need the 'clipboard.read' permission, writing/clearing 'clipboard.write'.
 */

/** Clipboard type: 'clipboard' (default) or Linux-only 'selection'. */
export type ClipboardType = 'selection' | 'clipboard'

/** Bookmark data read from / written to the clipboard (macOS / Windows). */
export interface ClipboardBookmark {
  /** Bookmark title. */
  title: string
  /** Bookmark URL. */
  url: string
}

/** Image source accepted by clipboard.writeImage (one of dataUrl/path/buffer). */
export interface ClipboardImageInput {
  /** Image content as a data URL. */
  dataUrl?: string
  /** Path to an image file on disk. */
  path?: string
  /** Raw encoded image bytes (PNG/JPEG; size hint used when the format needs it). */
  buffer?: ArrayBuffer
  /** Width hint for the raw buffer (used only with buffer). */
  width?: number
  /** Height hint for the raw buffer (used only with buffer). */
  height?: number
}

/** Result of clipboard.readImage: an empty image yields an empty dataUrl. */
export interface ClipboardReadImageResult {
  /** dataUrl of the image ('' when the clipboard holds no image). */
  dataUrl: string
  /** Image size in DIP. */
  size: { width: number; height: number }
}

/** Composite payload accepted by clipboard.write. */
export interface ClipboardWriteData {
  /** Plain text content. */
  text?: string
  /** HTML content. */
  html?: string
  /** Image content (dataUrl or file path). */
  image?: { dataUrl?: string; path?: string }
  /** RTF content. */
  rtf?: string
  /** Bookmark content (macOS / Windows). */
  bookmark?: ClipboardBookmark
}

/** Flat signature map for the clipboard module. */
export type ClipboardModuleApi = {
  /** Reads plain text from the clipboard. */
  'clipboard.readText'(): Promise<string>
  /** Reads HTML content from the clipboard. */
  'clipboard.readHTML'(type?: ClipboardType): Promise<string>
  /** Reads RTF content from the clipboard. */
  'clipboard.readRTF'(type?: ClipboardType): Promise<string>
  /** Reads a bookmark ({ title, url }) from the clipboard (macOS / Windows). */
  'clipboard.readBookmark'(): Promise<ClipboardBookmark>
  /** Reads the find text (macOS find pasteboard). */
  'clipboard.readFindText'(): Promise<string>
  /** Reads the clipboard image as { dataUrl, size } (dataUrl is '' when empty). */
  'clipboard.readImage'(type?: ClipboardType): Promise<ClipboardReadImageResult>
  /** Reads raw bytes stored under a format (experimental; delivered as a typed array). */
  'clipboard.readBuffer'(format: string): Promise<Uint8Array>
  /** Reads clipboard content by format (experimental). */
  'clipboard.read'(format: string): Promise<string>
  /** Lists the formats currently available on the clipboard. */
  'clipboard.availableFormats'(type?: ClipboardType): Promise<string[]>
  /** Checks whether the clipboard holds the given format (experimental). */
  'clipboard.has'(format: string, type?: ClipboardType): Promise<boolean>
  /** Writes plain text to the clipboard. */
  'clipboard.writeText'(text: string): Promise<void>
  /** Writes HTML content to the clipboard. */
  'clipboard.writeHTML'(markup: string, type?: ClipboardType): Promise<void>
  /** Writes RTF content to the clipboard. */
  'clipboard.writeRTF'(text: string, type?: ClipboardType): Promise<void>
  /** Writes a bookmark to the clipboard (macOS / Windows). */
  'clipboard.writeBookmark'(title: string, url: string, type?: ClipboardType): Promise<void>
  /** Writes the find text (macOS find pasteboard). */
  'clipboard.writeFindText'(text: string): Promise<void>
  /** Writes an image (dataUrl/path/buffer) to the clipboard. */
  'clipboard.writeImage'(image: ClipboardImageInput, type?: ClipboardType): Promise<void>
  /** Writes raw bytes under a format (experimental). */
  'clipboard.writeBuffer'(format: string, buffer: ArrayBuffer, type?: ClipboardType): Promise<void>
  /** Writes several representations at once ({ text, html, image, rtf, bookmark }). */
  'clipboard.write'(data: ClipboardWriteData, type?: ClipboardType): Promise<void>
  /** Clears the clipboard content. */
  'clipboard.clear'(type?: ClipboardType): Promise<void>
}
