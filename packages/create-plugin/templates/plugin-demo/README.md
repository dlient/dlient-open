# __PLUGIN\_ID__ (Template App)

## 1. Introduction

This is a dlient-open (open source) plugin template created via `@dlient-open/create-plugin` (`type: 'app'`, opened directly by the host launcher).

- **Minimal runnable UI**: `src/renderer/App.tsx` calls the worker's example method `__PLUGIN_ID__.greet` to show a message.

- **Frontend / worker separation**: `src/renderer` (UI) + `src/main` (worker, `dist/worker.js`).

- **Multi-language**: `src/renderer/i18n.ts` registers `zh-CN` / `en-US` strings via `@dlient-open/i18n`.

## 2. Exported Methods

| Method                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `__PLUGIN_ID__.greet` | Example method that returns a greeting message |

Key method signature:

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet')
```

## 3. Skills

See [assets/SKILL.md](assets/SKILL.md) for the AI Agent skill provided by this plugin.

## Development

1. Install dependencies: `npm install`.
2. Dev (hot reload): `npm run dev:watch` + `npm run dev:watch:worker`.
3. Build: `npm run build` (output to `dist/`).
4. Package: `npm run pack` → `<id>-<version>.dlient` (no signature).
5. Import in dlient-open (open source host, bottom-left "＋ Import plugin"); it appears under "Installed apps".

## Directory structure

```
__PLUGIN_ID__/
├── package.json              # manifest (dlient: id / name / type / source / icon / permissions...)
├── vite.config.ts            # plugin Vite build config
├── tsconfig.json
├── script/                   # build scripts (build-clean / build-worker / make-dlient …)
├── README.md / README.cn.md  # source docs (synced into assets/index*.md)
├── assets/                   # public resources (icon + docs + mcp + skill)
│   ├── icon.svg              # plugin icon (auto-generated from the plugin id initial letter)
│   ├── index.md              # plugin description (default / English)
│   ├── index.en-US.md        # English description
│   ├── index.zh-CN.md        # Chinese description
│   ├── mcp.json              # MCP tool descriptions
│   └── SKILL.md              # AI Agent skill
└── src/
    ├── renderer/             # UI (App.tsx / i18n.ts / styles.css / env.d.ts)
    └── main/index.ts         # worker entry
```

