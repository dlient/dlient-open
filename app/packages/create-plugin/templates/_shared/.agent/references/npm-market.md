# NPM Market & Search Keywords

## 1. NPM Market

The open-source host's console has a built-in **NPM Market** tab: it searches npm for dlient plugins by keyword and supports install / update directly from the host.

## 2. Search rules

The market combines the following terms into the search query (`keywords:` prefix = exact match against the npm package `keywords` array):

1. `keywords:dlient-open-plugin` — **required**; only plugin packages may use this keyword.
2. Type filter (App / Plugin):
   - **App** → `keywords:app`
   - **Plugin** → `keywords:plugin`
3. Category tag (keys in the table below) — adds `keywords:<key>` when selected.
4. Package-name keyword — free text (matches name / description / etc.).

Examples:

- "AI apps" → `keywords:dlient-open-plugin keywords:app keywords:ai`
- "development-tool plugins" → `keywords:dlient-open-plugin keywords:plugin keywords:dev-tools`

## 3. Category tags

| key                | 中文名         | English                   |
| ------------------ | -------------- | ------------------------- |
| `ai`               | AI 智能        | AI & Intelligence         |
| `productivity`     | 办公效率       | Productivity & Office     |
| `content-creation` | 内容创作       | Content Creation          |
| `dev-tools`        | 开发工具       | Development Tools         |
| `ui-design`        | 界面设计       | UI & Design               |
| `finance`          | 金融财务       | Finance & Accounting      |
| `games`            | 游戏娱乐       | Games & Entertainment     |
| `education`        | 教育学习       | Education & Learning      |
| `system`           | 系统工具       | System Utilities          |

## 4. Declaring keywords in a plugin package

When publishing a plugin to npm, the `keywords` array in `package.json` should include:

- `dlient-open-plugin` — **required**.
- The type keyword: `app` (standalone app, openable in the host) or `plugin` (capability plugin, not openable) — pick the one matching the plugin.
- The key(s) of the category/categories the plugin belongs to (e.g. `ai`, `dev-tools`).
- Other domain words (e.g. `deepseek`, `chat`).

Non-plugin packages (scaffolds / toolkits, etc.) **must not** contain `dlient-open-plugin`.
