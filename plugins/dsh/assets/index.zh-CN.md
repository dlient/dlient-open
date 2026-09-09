# dsh（DeepSeek Harness）

## 1. 插件介绍

dsh 在 dlient 中运行 **DeepSeek Harness（dsh）** 的 AI Agent Web UI（`type: 'app'`）。

- **worker**：解析 / 安装 Node.js（内置 `nodejs.*` host-api，优先内置 LTS）→ `npm install -g @deepseek-ai/dsh` → 启动 `dsh web --no-open`（默认 `http://127.0.0.1:3080`），探测端口就绪后把 URL 交给渲染端。
- **渲染端**：用 `@dlient-open/ui` 的 `Webview` 组件内嵌 DSH 网页（组件经本 worker 内建 `webview:*` 转发到主进程 WebContentsView）。

```
DSH（app）─ worker：Node.js → npm i -g @deepseek-ai/dsh → dsh web --no-open
DSH（渲染端）─ <Webview src=http://127.0.0.1:3080>
```

## 2. 导出的方法

| 方法 | 说明 |
|------|------|
| `dsh.start` | 确保 Node.js 与 DSH 就绪，启动 `dsh web` 服务并返回 URL |
| `dsh.stop` | 停止正在运行的 `dsh web` 服务（并清理 PID 文件 / 端口） |
| `dsh.status` | 查询服务状态（运行中 / URL） |

关键方法调用示例：

```ts
const { url } = await rpc.plugin.invoke('dsh', 'dsh.start')
const status = await rpc.plugin.invoke('dsh', 'dsh.status')
await rpc.plugin.invoke('dsh', 'dsh.stop')
```

## 3. skills 说明

本插件提供 AI Agent 技能，见 [skills/SKILL.md](skills/SKILL.md)：帮助代理启动 / 停止 DeepSeek Harness 服务并获取访问地址。

## 使用

1. 无需安装任何运行时插件：内置 `nodejs.*` host-api 会自动解析 Node.js（无则下载内置 LTS）。
2. 在 dlient 中打开 dsh 应用：首次会解析 Node.js（无则自动下载安装），随后安装 DSH 并启动服务。
3. 进入 DSH 界面后：Settings → Models 配置 API Key，再选择 Workspace 即可开始使用。

## 依赖

- 内置 host-api `nodejs.*`（开源版宿主在主进程内置运行时管理，**不再有 nodejs 插件**）：worker 调用 `rpc.nodejs.resolveRuntime()` / `rpc.nodejs.install()`（manifest 需声明 `nodejs.resolveRuntime` / `nodejs.install` 权限）；`dlient.dependencies.nodejs` 保留宿主对运行时的就绪门控。
- 宿主 UI 库 `@dlient-open/ui`：`Webview` 组件（manifest 需声明 `webview.create` / `webview.navigate` 权限）
