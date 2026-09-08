/**
 * RuntimeRegistry - 插件运行时状态唯一真相源。
 */

import type { PluginRuntime, PluginInstalled } from '@dlient-open/plugin-sdk'

export class RuntimeRegistry {
  private runtimes = new Map<string, PluginRuntime>()
  private installed = new Map<string, PluginInstalled>()

  getRuntime(pluginId: string): PluginRuntime | undefined {
    return this.runtimes.get(pluginId)
  }

  getRuntimes(): Map<string, PluginRuntime> {
    return new Map(this.runtimes)
  }

  setRuntime(pluginId: string, runtime: PluginRuntime): void {
    this.runtimes.set(pluginId, runtime)
  }

  updateStatus(pluginId: string, status: PluginRuntime['status'], error?: string): void {
    const runtime = this.runtimes.get(pluginId)
    if (runtime) {
      runtime.status = status
      if (error) {
        runtime.error = error
      } else {
        delete runtime.error
      }
      if (status === 'running') {
        runtime.startTime = Date.now()
      }
    }
  }

  incrementGeneration(pluginId: string): number {
    const runtime = this.runtimes.get(pluginId)
    if (!runtime) {
      throw new Error(`Plugin "${pluginId}" not found in registry`)
    }
    runtime.generation += 1
    return runtime.generation
  }

  removeRuntime(pluginId: string): void {
    this.runtimes.delete(pluginId)
  }

  setInstalled(pluginId: string, installed: PluginInstalled): void {
    this.installed.set(pluginId, installed)
  }

  getInstalled(pluginId: string): PluginInstalled | undefined {
    return this.installed.get(pluginId)
  }

  getInstalledList(): PluginInstalled[] {
    return Array.from(this.installed.values())
  }

  isInstalled(pluginId: string): boolean {
    return this.installed.has(pluginId)
  }
}
