# @dlient-open/api-types — host-api 共享单源类型

目的：把 host-api 的**方法签名 + 参数/返回类型 + 英文说明**收敛为单一来源，worker（`@dlient-open/plugin-sdk`）与 UI（`@dlient-open/api-bridge`）两端引用同一套类型，避免双份漂移。

## 真源
主进程 api 目录 `app/src/main/api/*.ts`（方法 key、handler 实际读取的参数字段、英文 description）。新增/修改 host-api 时先改 api 目录，再同步本包。

## 文件布局
- `src/index.ts`：汇总导出（主会话维护，勿动）。
- `src/modules/<module>.ts`：每个 host-api 模块一个文件。

## 每个模块文件导出约定（样板见 `src/modules/notification.ts`）
1. 该模块的方法**输入 Options 接口**（字段逐一加英文注释；字段语义以主进程 handler 实际读取为准）。
2. 返回值类型（从 handler 返回结构提取）。
3. 扁平签名类型：key = 完整点路径（如 `'fs.read'`），值为方法函数类型。
   命名：模块类型名 `<Cap>ModuleApi`，值形如：
   ```ts
   export type FsModuleApi = {
     'fs.read'(options: FsReadOptions): Promise<FsReadResult>
   }
   ```
4. 每个方法一条英文 JSDoc 注释（一句话，说明用途/注意点），放在签名成员上。

## 通用约束
- 全部注释用英文。
- 参数用**具名 options 对象**（与 handler 一致），不出现 `any` 参数。
- 方法若无参/基本类型，直接签名（如 `'app.getVersion'(): Promise<string>`）。
- 不导入任何运行时依赖；文件内只含 type/interface 声明（type-only）。
- 保留 `@dlient-open/plugin-sdk/src/host-api.ts` 顶部模块列表的既有已文档化字段（如 NotificationSendOptions）作参考。

## 修改 host-api 的同步流程（重要）
1. 改主进程 `app/src/main/api/*.ts`（真源：方法行为/description）。
2. 同步本包 `src/modules/<module>.ts`：方法签名/options/返回类型/英文注释（改 method key 时同步改）。
3. 两端类型**自动跟随**：`@dlient-open/plugin-sdk` host-api.ts 与 `@dlient-open/api-bridge` 均以 `HostApiMap['<path>']` 引用本包，无需再手写双份。
4. 运行时 path 表保持：plugin-sdk `HOST_API_PATHS` / api-bridge `UI_HOST_API_PATHS` 增删 key 时与本包同步（防路径漂移）。
5. 改完执行：`npm --prefix app/packages/api-types run build`，再 rebuild plugin-sdk / api-bridge / ui，并把 dist 同步到 app 与插件 node_modules（发布时按 registry 依赖传递，无需手工同步）。

## 发布顺序
`@dlient-open/api-types` 先发 → `@dlient-open/plugin-sdk`、`@dlient-open/api-bridge`、`@dlient-open/ui` 依序发新版本（它们已声明对 api-types 的依赖）。
