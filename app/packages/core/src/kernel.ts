/**
 * Kernel - 服务容器 + 事件总线 + 逆序回收的生命周期管理。
 */

type ServiceFactory<T> = () => T

/** 事件处理器的存储形态（订阅侧泛型经 on 收窄，此处只需可调用签名） */
type EventHandler = (payload?: unknown) => void

export interface Disposable {
  dispose(): void
}

export class Kernel implements Disposable {
  private services = new Map<string, unknown>()
  private factories = new Map<string, ServiceFactory<unknown>>()
  private disposers: Array<() => void> = []
  private listeners = new Map<string, Set<EventHandler>>()

  register<T>(name: string, factory: ServiceFactory<T>): void {
    this.factories.set(name, factory as ServiceFactory<unknown>)
  }

  get<T>(name: string): T {
    if (this.services.has(name)) {
      return this.services.get(name) as T
    }
    const factory = this.factories.get(name)
    if (!factory) {
      throw new Error(`Service "${name}" not registered`)
    }
    const instance = factory()
    this.services.set(name, instance)
    return instance as T
  }

  registerDisposable(fn: () => void): void {
    this.disposers.push(fn)
  }

  emit<T = unknown>(event: string, payload?: T): void {
    const handlers = this.listeners.get(event)
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(payload)
        } catch (err) {
          console.error(`[Kernel] Error in event handler for "${event}":`, err)
        }
      })
    }
  }

  on<T = unknown>(event: string, handler: (payload?: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    const handlers = this.listeners.get(event)!
    handlers.add(handler as EventHandler)
    return () => {
      handlers.delete(handler as EventHandler)
    }
  }

  dispose(): void {
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        this.disposers[i]()
      } catch (err) {
        console.error('[Kernel] Error during disposal:', err)
      }
    }
    this.disposers = []
    this.services.clear()
    this.factories.clear()
    this.listeners.clear()
  }
}
