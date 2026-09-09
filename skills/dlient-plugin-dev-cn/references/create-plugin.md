# 创建插件（脚手架 / 模板 / 开发流程）

## 1. 脚手架

用官方开源脚手架（模板单源 `plugin-demo`）：

```bash
npx @dlient-open/create-plugin my-plugin                   # 生成 ./my-plugin
npx @dlient-open/create-plugin my-plugin --name "我的插件"  # 显示名（缺省 = 插件 id）
npx @dlient-open/create-plugin my-plugin --dir ~/dev       # 指定创建目录
npx @dlient-open/create-plugin my-plugin --native-host     # 原生模块：官方 Node 子进程模式（native-host，免 rebuild）
npx @dlient-open/create-plugin my-plugin --native          # 原生模块：随包 + @electron/rebuild（逐平台构建）
```

开源脚手架**没有 `--port` / `--devPort`、也没有 `--asar`**：热重载是**产物级 watch**（见 §4），构建产物恒为普通 `dist/` 目录（无 asar / plugin.json 形态）。

脚手架**默认不执行 npm install、不创建 git 仓库**；创建后进入插件目录自行安装/初始化。

- 插件 id 仅允许小写字母、数字、连字符（须以小写字母开头）。
- 开源版**无市场、无 dev-tools 入口**：运行插件要么用仓库 dev 源码布局（见 §4），要么打好 `.dlient` 后在宿主操作台「导入插件」导入。

## 2. 模板目录结构

模板与开源 `plugin-demo` 模板一致（见 `app/packages/create-plugin/templates/plugin-demo`）：

```
my-plugin/
├── package.json              # manifest（dlient 子对象）
├── vite.config.ts            # createPluginViteConfig 预设（SystemJS 产物）
├── tsconfig.json
├── skills/
│   └── SKILL.md              # 可选 AI Agent 技能文档（保留在 skills/）
├── assets/                   # 装配后的公开资源
│   ├── icon.svg              # 必填图标（manifest dlient.icon；按插件 id 首字母取图）
│   ├── index.md              # 插件说明（默认 / 英文）
│   ├── index.zh-CN.md        # 中文说明（可选）
│   ├── index.en-US.md        # 英文说明变体（可选）
│   └── mcp.json              # 可选 MCP 工具描述（由根目录移入）
├── script/
│   ├── build-clean.mjs       # 清理 dist/
│   ├── build-worker.mjs      # → dist/worker.js（存在 src/native-host/ 时 + dist/native-host.js）
│   ├── make-dlient.mjs       # npm run pack → <id>-<version>.dlient（本地、免签名）
│   └── build-native.mjs      # 仅 --native 生成时存在
└── src/
    ├── main/index.ts         # worker 入口
    ├── native-host/          # 仅 --native-host（index.ts）
    └── renderer/             # UI：App.tsx / i18n.ts / styles.css / env.d.ts
```

## 3. 安装与构建

```bash
cd my-plugin
npm install
npm run build        # UI → dist/remoteEntry.js（+ style.css/assets）；worker → dist/worker.js
```

模板标准脚本（来自模板 `package.json`）：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | `build-clean` → `build:ui` → `build:worker`（`--native` 时 + `build:native`） |
| `npm run build:ui` | `vite build` → `dist/remoteEntry.js`（System.register）+ CSS |
| `npm run build:worker` | `node script/build-worker.mjs` → `dist/worker.js`（存在时 + `dist/native-host.js`） |
| `npm run dev:watch` | UI 变更即重建（`vite build --watch`） |
| `npm run dev:watch:worker` | worker 变更即重建（`build-worker.mjs --watch`） |
| `npm run dev` | 同时跑两个 watch 命令（产物级 watch） |
| `npm run pack` | `npm run build && node script/make-dlient.mjs` → 插件根目录生成 `<id>-<version>.dlient`（另支持 `node script/make-dlient.mjs --version x.y.z` / `--name x.dlient`） |

构建产物恒为**普通 `dist/` 目录**（`remoteEntry.js` / `worker.js` / …）——**没有 asar 打包、也没有 plugin.json 形态**。`.dlient` 即普通（store 压缩）zip：含 `package.json`（打包时改写 `dlient.source='local'` / `dlient.system=false`）、`assets/`、`skills/` 与 `<dist>/`（不含 `dist/node_modules`）；包本身不带签名——导入后由宿主本地签名（见 §5）。

## 4. 运行与调试

开源版无市场 / dev-tools，对着宿主跑有两条路：

1. **仓库 dev 源码流程（dev）** —— 把插件源码放进 `dlient-open/plugins/<插件id>`（宿主 dev 源码目录；`source: 'dev'`，`@dev` 实例免验签）。执行 `npm run dev`（或两个 watch 命令）——watch 产物（`vite build --watch` + worker esbuild `--watch`）。产物变更后重开 / 重载宿主生效；**无 dev server 端口**。
2. **导入流程（已安装）** —— `npm run pack` 后在宿主操作台用「导入插件」选择 `.dlient`。宿主弹出确认框（权限 tab + preInstall 依赖 tab），安装期/安装时深度安装声明的 `preInstall` 依赖。

日志：

- worker 与 UI 写入 `USER_DATA/plugin-data/<插件id>/logs/main.log`（JSONL，一行一个 JSON）；`USER_DATA` = `~/.dlient-open`。
- 仓库 dev 流程下可直接 tail 该文件，或经日志相关 host-api 拉取。

权限排障：

- 未授权调用抛 `PERMISSION_DENIED`（`-2107`），宿主写 `security` 审计行；
- 开发期逃生（勿用于生产）：`DLIENT_DISABLE_PERMISSION=1`、`DLIENT_DISABLE_FS_ENFORCE=1`。

## 5. 分发与安装（开源版，仅本地）

开源宿主**无市场上传、无审核、无服务端 / 平台签名、无组织背书**。分发只走本地：

**A. 打 `.dlient` 包**

在插件工程内执行 `npm run pack`：先构建，再由 `make-dlient.mjs` 在插件根目录产出 `<id>-<version>.dlient`（改写 manifest 副本：`dlient.source='local'`、`dlient.system=false`；含 `assets/` + `skills/` + `<dist>/`，不含 `dist/node_modules`）。把文件发给别人或自己导入。

**B. 导入（宿主操作台 →「导入插件」）**

1. 选择 `.dlient`；宿主解析 manifest 后弹**确认框**：权限 tab（逐项列出声明的权限并带安装风险色点：`default` 灰 / `warn` 橙 / `dangerous` 红）+ 依赖 tab（`preInstall` 条目）。
2. **深度安装**：manifest 声明 `preInstall` 时，宿主先递归安装每个依赖——npm（semver → 拉 npm 包，在包根 / `pack/` / `dist/` 找其 `.dlient`）、GitHub（最新 Release 的 `*.dlient` 资产）或 `.dlient` 直链。
3. 插件解包落到 `USER_DATA/plugins/<id>`（`~/.dlient-open/plugins/…`），manifest 改写为 `source='local'`、`system=false`。
4. **本地完整性签名**：落盘后宿主用内嵌 Ed25519 密钥写 `signature.json`（format=1；`files` 仅含 `package.json` + `dist/**` 的 `sha256:<hex>`）。启动 / 协议加载时宿主校验；仓库 dev 源码目录（`@dev`）跳过；无 `signature.json`（历史 / 旧导入）放行。

已安装插件落在 `~/.dlient-open/plugins/`；宿主 userData 根为 `~/.dlient-open`。

## 6. 常见问题

| 现象 | 可能原因 / 处理 |
| --- | --- |
| `permission denied … -2107` | 缺 `manifest.permissions` 或资源授权。补权限，或在弹框 / 权限页授权。 |
| worker 起不来 / 一直 `starting` | `dist/worker.js` 未构建，或 worker 阻塞事件循环（心跳超时）。 |
| UI 空白 / 无样式 | `remoteEntry.js` 未构建；检查 `dist/` 与 `dlientV3://` 资源日志。 |
| 类型推断与预期不符 | `type` 缺省为 `app`；`full`/`worker`/`ui` 请显式声明。 |
| 导入因缺依赖失败 | 插件声明了未安装的 `preInstall` / `dependencies` 插件；先导入对应依赖（或导入会深度安装依赖的 `.dlient`）。 |
| 插件对 `nodejs` 显示「未就绪」 | `dlient.nodeVersion`（或 nodejs 依赖）触发就绪门控；宿主自动安装内置 Node 运行时，或经 Node 对话框安装。 |
