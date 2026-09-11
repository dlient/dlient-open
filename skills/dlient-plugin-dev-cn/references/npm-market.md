# NPM 市场与检索关键词

## 1. NPM 市场

开源宿主操作台内置 **NPM 市场** tab：按关键词检索 npm 上发布的 dlient 插件，并支持直接在宿主内安装 / 更新。

## 2. 检索规则

市场搜索时按以下规则组合关键词（`keywords:` 前缀 = 精确匹配 npm 包 `keywords` 数组）：

1. `keywords:dlient-open-plugin` —— **必填**；仅插件包允许使用该 keyword。
2. 类型筛选（应用 / 插件）：
   - **应用** → `keywords:app`
   - **插件** → `keywords:plugin`
3. 分类标签（下表 key）——选中后加入 `keywords:<key>`。
4. 包名关键词 —— 自由文本（匹配包名 / 描述等）。

示例：

- 搜索「AI 智能的应用」→ `keywords:dlient-open-plugin keywords:app keywords:ai`
- 搜索「开发工具的插件」→ `keywords:dlient-open-plugin keywords:plugin keywords:dev-tools`

## 3. 分类标签表

| key                | 中文名   | English               |
| ------------------ | -------- | --------------------- |
| `ai`               | AI 智能  | AI & Intelligence     |
| `productivity`     | 办公效率 | Productivity & Office |
| `content-creation` | 内容创作 | Content Creation      |
| `dev-tools`        | 开发工具 | Development Tools     |
| `ui-design`        | 界面设计 | UI & Design           |
| `finance`          | 金融财务 | Finance & Accounting  |
| `games`            | 游戏娱乐 | Games & Entertainment |
| `education`        | 教育学习 | Education & Learning  |
| `system`           | 系统工具 | System Utilities      |

## 4. 插件包 keywords 配置

发布插件包到 npm 时，`package.json` 的 `keywords` 数组应包含：

- `dlient-open-plugin` —— **必填**。
- 类型 keyword：`app`（独立应用，宿主内可打开）或 `plugin`（能力插件，不可打开）——按插件实际类型填写。
- 插件所属分类的 key（可多个，如 `ai`、`dev-tools`）。
- 与插件领域相关的其它词（如 `deepseek`、`chat`）。

非插件包（脚手架 / 工具包等）**不得**包含 `dlient-open-plugin`。
