# Creating a Plugin (scaffold, template, dev workflow)

## 1. Scaffold

Use the official open-source scaffolder. It ships **four templates** (four modes) under
`app/packages/create-plugin/templates/`: `default`, `worker`, `native-host`, `native`. The mode flags
are **mutually exclusive** — passing two different ones errors out. With **no flag** you get `default`.

```bash
npx @dlient-open/create-plugin my-plugin                    # default: UI only (no worker, no skills/)
npx @dlient-open/create-plugin my-plugin --worker           # worker: UI + worker (RPC / subprocesses)
npx @dlient-open/create-plugin my-plugin --native-host      # native-host: worker + native modules via the official-Node child (no rebuild)
npx @dlient-open/create-plugin my-plugin --native           # native: worker + vendored prebuilds (@electron/rebuild, per platform)
npx @dlient-open/create-plugin my-plugin --name "My Plugin" # display name (default = id)
npx @dlient-open/create-plugin my-plugin --dir ~/dev        # target directory
```

| Mode | Flag | Template | Adds over `default` |
| --- | --- | --- | --- |
| `default` | (none) | `templates/default` | — (UI only: no `src/main/`, no `dist/worker.js`, no `build:worker`, no `skills/`) |
| `worker` | `--worker` | `templates/worker` | `src/main/index.ts`, `dist/worker.js`, `build:worker` / `dev:watch:worker`, `skills/` |
| `native-host` | `--native-host` | `templates/native-host` | worker + `src/native-host/index.ts` + `dlient.nativeModules` (official-Node child, no `@electron/rebuild`) |
| `native` | `--native` | `templates/native` | worker + `script/build-native.mjs` + `dlient.native: true` (vendored prebuilds, `@electron/rebuild`) |

`--native-host` and `--native` are **separate, exclusive modes**: `--native-host` does **not** imply or
require `--native` (it uses the official-Node child and needs no rebuild).

All four templates **share one `.agent/` directory** (developer docs + copy-ready `example/` sources)
generated from the `dlient-plugin-dev` skill, and it is copied into every generated project.

There is no `--port` / `--devPort` and no `--asar` in the open-source scaffold: hot reload is an **output-level watch** (see §4), and the build output is always a plain `dist/` directory (no asar / plugin.json).

The scaffold does **not** run `npm install` and does **not** create a git repository. After scaffolding, `cd` into the plugin and install deps yourself.

- Plugin ids allow only lowercase letters, digits and hyphens (must start with a lowercase letter).
- Open source has **no Market and no Dev-Tools entry**: to run a plugin you either use the repo dev-source layout (see §4) or build a `.dlient` and import it from the host console ("Import plugin").

## 2. Template directory tree

Every mode shares the same base (files shown here exist in **all four** modes):

```
my-plugin/
├── package.json              # manifest (dlient sub-object)
├── vite.config.ts            # createPluginViteConfig preset (SystemJS output)
├── tsconfig.json
├── assets/                   # assembled at scaffold time:
│   ├── icon.svg              #   required icon (manifest dlient.icon; picked by the plugin id initial)
│   ├── index.md              #   intro (default / English)
│   ├── index.zh-CN.md        #   Chinese intro
│   ├── index.en-US.md        #   English intro variant
│   └── mcp.json              #   optional MCP tool descriptions (moved from the root)
├── script/
│   ├── build-clean.mjs       # cleans dist/
│   └── make-dlient.mjs       # npm run pack → <id>-<version>.dlient (local, unsigned)
├── src/
│   └── renderer/             # UI: App.tsx / i18n.ts / styles.css / env.d.ts
└── .agent/                   # shared developer docs + example sources (all four modes)
```

Mode-specific files (**only the files listed for a mode exist in that mode**):

```
# default — UI only
(no extra files: no src/main/, no build-worker.mjs, no skills/)

# worker — UI + worker
├── script/build-worker.mjs
├── src/main/index.ts
└── skills/SKILL.md

# native-host — UI + worker + native modules (official-Node child)
├── script/build-worker.mjs
├── src/main/index.ts
├── src/native-host/index.ts
└── skills/SKILL.md

# native — UI + worker + vendored prebuilds
├── script/build-worker.mjs
├── script/build-native.mjs
├── src/main/index.ts
└── skills/SKILL.md
```

`.agent/` mirrors this skill (`SKILL.md`, `references/`, `example/`); it is not part of the plugin's
build output, only developer documentation shipped with the project.

## 3. Install & build

```bash
cd my-plugin
npm install
npm run build        # default: UI → dist/remoteEntry.js
                     # worker / native-host / native: also worker → dist/worker.js (+ dist/native-host.js)
```

Standard scripts (from the per-mode template `package.json`); `✓` = present in that mode, `—` = absent:

| Command | Effect | default | worker | native-host | native |
| --- | --- | :---: | :---: | :---: | :---: |
| `npm run build` | `build-clean` → `typecheck` → `build:ui`; then `build:worker` in worker / native-host / native; then `build:native` in native | ✓ | ✓ | ✓ | ✓ |
| `npm run build:ui` | `vite build` → `dist/remoteEntry.js` (System.register) + CSS | ✓ | ✓ | ✓ | ✓ |
| `npm run build:worker` | `node script/build-worker.mjs` → `dist/worker.js` (+ `dist/native-host.js` when `src/native-host/` exists) | — | ✓ | ✓ | ✓ |
| `npm run build:native` | `node script/build-native.mjs` → `@electron/rebuild` the vendored prebuilds | — | — | — | ✓ |
| `npm run dev:watch` | UI rebuild on change (`vite build --watch`) | ✓ | ✓ | ✓ | ✓ |
| `npm run dev:watch:worker` | worker rebuild on change (`build-worker.mjs --watch`) | — | ✓ | ✓ | ✓ |
| `npm run dev` | run the watch commands (output-level watch) | ✓ | ✓ | ✓ | ✓ |
| `npm run pack` | `npm run build && node script/make-dlient.mjs` → `<id>-<version>.dlient` at the plugin root (also supports `--version x.y.z` / `--name x.dlient`) | ✓ | ✓ | ✓ | ✓ |

**Upgrading a `default` project (no re-scaffold).** Follow `references/mode-switch-worker.md`,
`references/mode-switch-native-host.md` or `references/mode-switch-native.md`, using the copy-ready
sources in `example/worker/` / `example/native-host/` (`.agent/example/...` inside a generated
project); the `native` mode reuses the worker sources plus `script/build-native.mjs` from the
`templates/native` scaffold.

The build output is always a **plain `dist/` directory** (`remoteEntry.js` / `worker.js` / …) — there is no `asar` packaging and no `plugin.json` form. `.dlient` is an ordinary (store-compressed) zip containing `package.json` (with `dlient.source='local'` / `dlient.system=false` patched at pack time), `assets/`, `skills/` and `<dist>/` (excluding `dist/node_modules`); no signature is attached — the host signs locally after import (see §5).

## 4. Run & debug

Open source has no Market / Dev-Tools; run against the host in one of two ways:

1. **Repo dev-source flow (dev)** — place the plugin source under `dlient-open/plugins/<pluginId>` (the host's dev source dir; `source: 'dev'`, `@dev` instances are signature-exempt). Run `npm run dev` (or the two watch commands) — it watches the output (`vite build --watch` + worker esbuild `--watch`). Output changes take effect after you reopen / reload the host; there is **no dev-server port**.
2. **Import flow (installed)** — `npm run pack`, then in the host console use **"Import plugin"** and pick the `.dlient`. The host shows a confirm dialog (permissions tab + preInstall dependencies tab) and deep-installs declared `preInstall` deps before/while installing.

Logs:

- worker & UI write to `USER_DATA/plugin-data/<pluginId>/logs/main.log` (JSONL, one JSON per line); `USER_DATA` = `~/.dlient-open`.
- In the repo dev flow you can tail the file directly or pull lines through the log APIs.

Permission troubleshooting:

- a denied call throws `PERMISSION_DENIED` (`-2107`); the host writes a `security` audit line;
- dev-mode escapes (not for production): `DLIENT_DISABLE_PERMISSION=1`, `DLIENT_DISABLE_FS_ENFORCE=1`.

## 5. Distribution & install (open-source, local only)

There is **no market upload, no review, no server-side / platform signature and no organization endorsement** in the open-source host. Distribution is local:

**A. Package a `.dlient`**

Run `npm run pack` inside the plugin project: it builds first, then `make-dlient.mjs` produces `<id>-<version>.dlient` at the plugin root (patched manifest copy: `dlient.source='local'`, `dlient.system=false`; `assets/` + `skills/` + `<dist>/` included, `dist/node_modules` excluded). Share the file with others or import it yourself.

**B. Import (host console → "Import plugin")**

1. Pick the `.dlient`; the host parses the manifest and shows a **confirm dialog**: a permissions tab (each declared permission listed with its install-risk dot: `default` grey / `warn` orange / `dangerous` red) and a dependencies tab (the `preInstall` entries).
2. **Deep install**: if the manifest declares `preInstall`, the host recursively installs each dependency first — npm (`semver` → pull the npm package and find its `.dlient` at the package root / `pack/` / `dist/`), GitHub (latest Release's `*.dlient` asset), or a direct `.dlient` URL.
3. The plugin is extracted into `USER_DATA/plugins/<id>` (`~/.dlient-open/plugins/…`), with the manifest rewritten to `source='local'`, `system=false`.
4. **Local integrity signing**: after import the host records a local integrity signature (`signature.json`). Editing an installed plugin's files breaks verification. Repo dev-source dirs (`@dev`) are skipped, and packages without a `signature.json` are allowed.

Installed plugins live in `~/.dlient-open/plugins/`; the host user-data root is `~/.dlient-open`.

## 6. Common troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `permission denied … -2107` | Missing `manifest.permissions` entry or resource grant. Add the permission or authorize through the dialog / grant page. |
| Worker never starts / status `starting` forever | Build missing `dist/worker.js`, or worker blocks the event loop. |
| UI blank / styles missing | `remoteEntry.js` not built; check `dist/` and the `dlientOpen://` asset log lines. |
| Type inference surprising | `type` defaults to `app`; declare `type` explicitly for `full` / `worker` / `ui`. |
| Import fails on a missing dependency | The plugin declares `preInstall` / `dependencies` for a plugin that is not installed; import that dependency first (or use a `.dlient` that brings it via deep install). |
| Plugin shows "not ready" for `nodejs` | `dlient.nodeVersion` (or a `nodejs` dependency) triggers readiness gating; the host auto-installs the bundled Node runtime, or you install it via the Node dialog. |
