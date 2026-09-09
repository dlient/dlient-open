# __PLUGIN_ID__（模板应用）

## 1. 插件介绍

这是由 `@dlient-open/create-plugin` 生成的 dlient-open（开源版）插件模板，默认类型为 **app**（`type: 'app'`，基座启动器直接打开页面）。

- **最小可运行 UI**：`src/renderer/App.tsx` 调用 worker 的示例方法 `__PLUGIN_ID__.greet` 展示一条消息。
- **前后端分离**：`src/renderer`（UI）+ `src/main`（worker，`dist/worker.js`）。
- **多语言**：`src/renderer/i18n.ts` 通过 `@dlient-open/i18n` 注册 `zh-CN` / `en-US` 文案。

## 2. 导出的方法

| 方法 | 说明 |
|------|------|
| `__PLUGIN_ID__.greet` | 示例方法：返回一条问候消息 |

关键方法调用示例：

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet')
```

## 3. skills 说明

本插件提供 AI Agent 技能，见 [skills/SKILL.md](skills/SKILL.md)：演示插件的最小技能，返回问候消息。

## 开发步骤

1. 安装依赖：`npm install`。
2. 启动开发（热重载）：`npm run dev:watch` + `npm run dev:watch:worker`。
3. 构建产物：`npm run build`（输出到 `dist/`）。
4. 打包：`npm run pack` → 生成 `<id>-<version>.dlient`（免签名）。
5. 在 dlient-open（开源版）左下角「＋ 导入插件」导入该 .dlient，即可在「已安装的应用」中打开。

## 目录结构

```
__PLUGIN_ID__/
├── package.json              # manifest（dlient 子对象：id / name / type / source / icon / permissions…）
├── vite.config.ts            # 插件 Vite 构建配置
├── tsconfig.json
├── script/                   # 构建脚本（build-clean / build-worker / make-dlient …）
├── README.md / README.cn.md  # 源文档（同步进 assets/index*.md）
├── skills/SKILL.md           # AI Agent 技能
├── assets/                   # 公开资源（图标 + 说明 + mcp）
│   ├── icon.svg              # 插件图标（按插件 id 首字母自动生成）
│   ├── index.md              # 插件说明（默认/英文）
│   ├── index.en-US.md        # 英文插件说明
│   ├── index.zh-CN.md        # 中文插件说明
│   └── mcp.json              # MCP 工具描述
└── src/
    ├── renderer/             # UI（App.tsx / i18n.ts / styles.css / env.d.ts）
    └── main/index.ts         # worker 入口
```
