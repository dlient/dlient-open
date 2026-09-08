/**
 * systemjs 最小类型声明（包本身不附带 d.ts）。
 * 仅声明 PluginView 使用到的 API：import / set / newModule。
 */
declare module 'systemjs' {
  export interface SystemJS {
    import(specifier: string): Promise<Record<string, unknown>>
    /** 注册命名模块；普通对象会被自动包装成 module namespace（SystemJS 6 无 newModule） */
    set(name: string, module: Record<string, unknown>): void
    get(name: string): unknown
    has(name: string): boolean
    delete(name: string): boolean
    /** 追加 import map（裸依赖名 → URL，registry 解析用） */
    addImportMap(map: { imports: Record<string, string> }, mapBase?: string): void
    /** 动态配置（dev 插件 HMR 用：baseURL 指向插件 dev server，根绝对导入据此解析） */
    config(config: { baseURL?: string }): void
    /** SystemJS registry（URL → module namespace）；dev 图刷新按前缀清理 */
    getRegistry(): Map<string, unknown>
  }
  const SystemJS: SystemJS
  export default SystemJS
}
