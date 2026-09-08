/**
 * notification host-api — typed single source.
 * Real source of truth: app/src/main/api/notification.ts (handler reads these fields).
 * All docs are English; keep in sync with the main-process api table.
 */

/**
 * Options accepted by notification.send.
 * Identity fields (group_id/group_title/subtitle/icon) are NOT part of the public surface:
 * the host derives them from the sending plugin and injects them when the notification is sent,
 * so a plugin cannot impersonate another plugin or override its branding. Only content fields
 * below may be provided by the caller.
 */
export interface NotificationSendOptions {
  /** Notification title. Required. */
  title: string
  /** Optional body text. */
  body?: string
  /** Whether the notification is silent (no sound). Defaults to false. */
  silent?: boolean
  /** Whether to show an inline reply box. Defaults to false. */
  hasReply?: boolean
  /** Placeholder text for the reply box (only meaningful when hasReply is true). */
  replyPlaceholder?: string
  /** Action buttons. 'reply' actions are carried by hasReply and mapped to buttons by the host. */
  actions?: { type: 'button' | 'reply'; text: string }[]
  /** Custom close-button text (macOS system notification / in-app strip). */
  closeButtonText?: string
  /** 'default' auto-dismisses; 'never' keeps the notification until dismissed (Windows system engine / in-app). */
  timeoutType?: 'default' | 'never'
}

/** Result of a successful notification.send call: the handle id used for events/removal. */
export interface NotificationSendResult {
  id: string
}

/** Notification lifecycle event names delivered to the send handle via host push. */
export type NotificationEventName = 'click' | 'close' | 'reply' | 'action' | 'failed' | 'show'

/** Payload attached to notification events (action carries index, reply carries text, failed carries error). */
export interface NotificationEventPayload {
  index?: number
  reply?: string
  error?: string
}

/**
 * Handle returned by notification.send on the SDK/UI surface (identical shape for worker
 * `rpc.notification.send` and UI `api.notification.send`). The SDK performs the subscribe
 * handshake; lifecycle events stream back to the local `on(...)` callbacks. close() closes
 * this notification (owner-checked).
 */
export interface NotificationHandle {
  readonly id: string
  /** Subscribes to notification lifecycle events ('click' | 'close' | 'reply' | 'action' | 'failed' | 'show'). */
  on(event: NotificationEventName, cb: (payload?: NotificationEventPayload) => void): NotificationHandle
  /** Closes this notification (equivalent to notification.remove(id)). */
  close(): Promise<void>
}

/** Flat signature map for the notification module. */
export type NotificationModuleApi = {
  /** Whether system notifications are supported on this platform. */
  'notification.isSupported'(): Promise<boolean>
  /**
   * Sends a notification and returns its handle id.
   * Worker/UI SDKs wrap this into a handle supporting on('click'|'close'|'reply'|'action'|'failed'|'show').
   * macOS foreground is routed to the in-app notification strip automatically.
   */
  'notification.send'(options: NotificationSendOptions): Promise<NotificationSendResult>
  /**
   * Closes a notification by id. Owner-checked: only notifications sent by this plugin can be closed;
   * other plugins' ids return PERMISSION_DENIED. Works for both system and in-app engines.
   */
  'notification.remove'(id: string): Promise<void>
  /** Closes all notifications sent by this plugin (both system and in-app engines). No argument needed. */
  'notification.removeGroup'(): Promise<void>
  /** Subscribes to events of a notification id (owner-checked). Usually called automatically by the SDK handle. */
  'notification.subscribe'(options: { id: string }): Promise<void>
  /** Unsubscribes from events of a notification id (owner-checked). Usually called automatically by the SDK handle. */
  'notification.unsubscribe'(options: { id: string }): Promise<void>
}
