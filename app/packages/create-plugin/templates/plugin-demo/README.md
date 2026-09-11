# __PLUGIN_ID__ (Template App)

## 1. Introduction

This is a dlient-open (open source) plugin template created via `@dlient-open/create-plugin` (`type: 'app'`, opened directly by the host launcher).

- **Minimal runnable UI**: `src/renderer/App.tsx` calls the worker's example method `__PLUGIN_ID__.greet` to show a message.

- **Frontend / worker separation**: `src/renderer` (UI) + `src/main` (worker, `dist/worker.js`).

- **Multi-language**: `src/renderer/i18n.ts` registers `zh-CN` / `en-US` strings via `@dlient-open/i18n`.

## 2. Exported Methods

| Method                 | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `__PLUGIN_ID__.greet`  | Example method that returns a greeting message                                   |
| `__PLUGIN_ID__.echo`   | Example method that returns a business-error envelope (`rpc.error` + localized message) |
| `__PLUGIN_ID__.guard`  | Example method that throws `PluginError` (the SDK wraps it into a failure envelope) |

Key method signature:

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet')
```

Keep `dlient.expose` in `package.json`, this table, `skills/SKILL.md` and `mcp.json` in sync when you add or remove methods.

## 3. Permissions

The template declares only `log` (worker `rpc.log.write` + UI `api.log.write` / `LogViewer`), which is all the example code needs.

Add capabilities to `dlient.permissions` as you actually use them, and keep the list minimal — every entry is shown to the user at install time. Resource-level access is declared separately (`fsDirs`, `spawnCmds`) or granted at runtime (`permission.request`).

## 4. Skills

See [skills/SKILL.md](skills/SKILL.md) for the AI Agent skill provided by this plugin.

## Development

1. Install dependencies: `npm install`.
2. Dev (hot reload): `npm run dev:watch` + `npm run dev:watch:worker` (or `npm run dev` for both).
3. Build: `npm run build` (typecheck → UI → worker; output to `dist/`).
4. Package: `npm run pack` → `<id>-<version>.dlient` (no signature).
5. Import in dlient-open (open source host, bottom-left "＋ Import plugin"); it appears under "Installed apps".

## Directory structure

```
__PLUGIN_ID__/
├── package.json              # manifest (dlient: id / name / type / source / icon / permissions / expose...)
├── vite.config.ts            # plugin Vite build config (UI preset)
├── tsconfig.json
├── AGENTS.md                 # AI coding-agent entry (points to .agent/)
├── .agent/                   # dlient plugin development docs for coding agents
├── script/                   # build scripts (build-clean / build-worker / make-dlient …)
├── README.md / README.cn.md  # source docs (synced into assets/index*.md)
├── mcp.json                  # MCP tool descriptions (moved into assets/ on scaffold)
├── skills/SKILL.md           # AI Agent skill of this plugin
├── assets/                   # public resources (icon + plugin description + mcp)
│   ├── icon.svg              # plugin icon (auto-generated from the plugin id initial letter)
│   ├── index.md              # plugin description (default / English)
│   ├── index.en-US.md        # English description
│   ├── index.zh-CN.md        # Chinese description
│   └── mcp.json              # MCP tool descriptions
└── src/
    ├── renderer/             # UI (App.tsx / i18n.ts / styles.css)
    └── main/index.ts         # worker entry
```
