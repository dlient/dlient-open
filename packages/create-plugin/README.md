# @dlient-open/create-plugin

dlient-open 开源版插件开发脚手架：一条命令在当前目录创建适配开源宿主（layout 导入 .dlient）的插件开发包（模板单源 `templates/plugin-demo`）。

## 用法

```bash
npx @dlient-open/create-plugin my-plugin                    # 当前目录创建 my-plugin/
npx @dlient-open/create-plugin my-plugin --name "我的插件"   # 指定显示名（缺省 = 插件 id）
npx @dlient-open/create-plugin my-plugin --dir ~/dev        # 指定创建目录
npx @dlient-open/create-plugin my-plugin --native-host      # 原生模块（native-host 模式：官方 Node 子进程，免 rebuild）
npx @dlient-open/create-plugin my-plugin --native           # 原生模块（vendor + @electron/rebuild，逐平台构建）
```

默认**不执行 npm install、不创建 git 仓库**；创建后进入插件目录自行安装/初始化。

按参数生成不同 manifest / 模板代码：`--native-host` 写 `dlient.nativeModules` + `src/native-host/` + `@dlient-open/native-host-sdk`；`--native`（无 native-host）写 `dlient.native=true` + `@electron/rebuild`。

> 说明：开源版**无插件市场、无签名/服务端**。插件构建产物为 dist 多文件（remoteEntry.js + worker.js），`npm run pack` 直接产出**免签名 .dlient**，dlient-open 开源宿主左下角「导入插件」即可安装。

## 生成的插件包

- `src/renderer`：插件 UI（react + shadcn 风格 primitives，经 `@dlient-open/ui`）
- `src/main`：插件 worker（`createWorkerRpc` + `rpc.log.write` 日志示例）
- `src/native-host`（仅 `--native-host`）：原生模块宿主入口（官方 Node 子进程）
- `package.json`：`dlient` 子对象 manifest（含权限 / expose / 多语言 / platforms）
- 构建：`npm run build`（UI remoteEntry.js + worker.js；统一普通打包，dist 多文件）

## 依赖 @dlient-open/*

模板 devDependencies 引用 `@dlient-open/*`（api-bridge / i18n / plugin-sdk / ui / native-host-sdk）registry 版本。**发布到 npm 前**可临时用本地 `file:` 链接（dlient-open 仓库 `app/packages/<pkg>`）：

```bash
npm i -D file:<dlient-open路径>/app/packages/ui file:<dlient-open路径>/app/packages/i18n \
       file:<dlient-open路径>/app/packages/api-bridge file:<dlient-open路径>/app/packages/plugin-sdk
```

## 创建后

1. `cd <插件名>` && `npm install` && `npm run build`
2. `npm run pack` → 生成 `<id>-<version>.dlient`
3. 打开 dlient-open（开源版）→ 左下角「＋ 导入插件」选择该 .dlient

## 开发（本仓库）

```bash
node bin/cli.mjs demo      # 本地测试（默认当前目录）
```

模板源：`templates/plugin-demo`（单源，直接入库）。发布：`node publish.mjs pack`（本地验证）→ `node publish.mjs publish`（registry）。
