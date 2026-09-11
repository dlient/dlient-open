# Development Standards

Coding rules for dlient plugin development. Follow these alongside the reference guides.

## 1. Worker standards

### 1.1 Sandbox boundaries

- **Never use `node:fs` / `child_process` / `.node` addons / `worker_threads` in the worker.** Everything goes through `rpc.{module}.{method}`; the process permission model bans the rest.
- File **writes** only into `DATA` (`USER_DATA/plugin-data/<pluginId>`) via `app.data.*` / granted `fs.*` paths. Never write into host dirs or other plugins' data.
- Do **not** call host-internal helpers (`child.register`, `child.killTree`, …) directly — use the SDK wrappers (`rpc.child.spawn` / `rpc.child.execFile`).

### 1.2 Never block the event loop

- **No synchronous blocking**: `spawnSync`/`execFileSync`/sync file I/O are forbidden — if the event loop freezes, the host restarts your worker.
- Heavy work must be async (`spawn`/`execFile`/`fs/promises`); decompress/unpack large data asynchronously.
- Prefer `workerMode: 'solo'` when the plugin does CPU-heavy work so a stall doesn't affect pooled neighbors.

### 1.3 Handler registration

- Register methods with `rpc.registerHandler('<pluginId>.<method>', handler)` (dotted namespace = plugin id).
- Register **idempotently** on boot — hot reload / worker restart re-runs `dist/worker.js`.
- Guard every publicly callable method with the matching `manifest.dlient.expose` entry and declare cross-plugin calls in `dependencies`.

### 1.4 Errors & localization

- Throw structured errors (`PluginError`, code range `-3001..`); never throw raw strings for expected failures.
- Do **not** hardcode user-facing Chinese/English copy in the worker. Return error codes / localized messages; the UI resolves text by locale (unknown codes fall back to the English `message`).

### 1.5 Logging

- Use `rpc.log.write(level, message, data?)` for worker logs (info/warn/error/debug; declare manifest.permissions `log` — no fs needed). Logs land in `plugin-data/<pluginId>/logs/main.log` as JSONL (read the file directly or pull via the log APIs).
- Keep log lines structured (`rpc.log.write('info', 'event', { …data })`), no `console.log` noise.

### 1.6 Subprocesses

- Spawn through `rpc.child.spawn` / `rpc.child.execFile` only; get a `ChildHandle`, attach `onStdout/onStderr/onExit/onError`, and `kill()` when done (idempotent).
- Commands must be covered by `manifest.dlient.spawnCmds` or runtime `spawn-confirm`; interpreters need an `argsPattern` object rule, not a bare string.
- Native modules: never in the worker — use `native`/`nativeModules` with the native-host.

### 1.7 Cross-plugin exposure & secrets

- **Expose policy**: don't add `dlient.expose` entries unless necessary (another plugin genuinely must call this one, or the user asks). A plugin can expose methods **if and only if it actually ships a worker** — i.e. its build output contains `dist/worker.js`; the manifest `type` is irrelevant (an `app`- or `ui`-typed plugin that ships `dist/worker.js` **can** expose, because the worker registers the handlers, while a plugin with no `dist/worker.js` cannot — nothing can serve the call → `WORKER_NOT_RUNNING`, `-2102`).
- Every exposed method needs a matching `rpc.registerHandler('<pluginId>.<method>', …)`. Prefer to also expose the `grant` handler (recommended, not required): `rpc.registerHandler('grant', …)` + the matching `expose.grant` entry; prefer `ask`, return `deny` for anything touching privacy, passwords, keys or other secrets, and `allow` only for clearly harmless methods.
- **Secrets**: encrypt passwords / keys / tokens with `app.crypt` (`rpc.app.crypt.encrypt` / `decrypt`, permission `app.crypt`) **before** storing them (e.g. in `app.data`, which is plaintext on disk); never hardcode them in source and never log or return them in plaintext.

## 2. UI standards

### 2.1 Use shared components — don't reinvent UI

- Import from **`@dlient-open/ui`** (shadcn-style components + lucide icons re-exported + dlient components). Avoid hand-rolled equivalents of `Button/Input/Select/Dialog/…`.
- Use `PluginIcon` for plugin icons (never re-implement), `PluginView` to embed other plugins' UI, `PluginErrorBoundary` to wrap views.
- Use `modal`/`createDialog` or `Dialog`/`AlertDialog` for feedback dialogs instead of custom overlays.
- **Icons: use lucide** (`Icon` or named imports from `@dlient-open/ui` — the **full** lucide set is re-exported). Do not draw custom SVGs/mask-icons when a lucide icon fits.
- Wrap long-running plugin views in `PluginErrorBoundary` so renderer errors don't break the host.

### 2.2 Accessing the host/worker

- UI ↔ worker through `useDlientApi` only (`api.request` / `api.onEvent`); handle the `{ ok, data, code }` envelope with `isApiOk`.
- **Always unsubscribe** `api.onEvent` on unmount (`useEffect` cleanup); otherwise the view leaks listeners and re-fires on hot reload.

### 2.3 i18n

- Register bundles once with `addResourceBundle('<pluginId>', { 'zh-CN': …, 'en-US': … })`; consume with `useI18n` → `t('<pluginId>.key')`.
- String values support `{{name}}` interpolation only. Localize host/worker error codes on this side.

### 2.4 Styles & theming

- **CSS is auto-scoped** (plugin-sdk build preset prefixes selectors with `[data-plugin="<pluginId>"] :where(...)`): your plugin's `.css` only applies to its view subtree and portals (portals land in a body-level container with the same `data-plugin` attribute), so no manual `<pluginId>-` class prefixes are needed. Use `:global(...)` to escape explicitly; `html/body/:root/*` are remapped to the plugin root. See `docs/specs/plugin-css-scope.md`.
- **Don't write `dui:*` utility classes in your markup**: the shared `@dlient-open/ui` stylesheet is precompiled from that package's own sources, so only the utilities it already uses exist — any other `dui:*` class silently does nothing. Use plain CSS / `*.module.css` for your own layout and take the visuals from the shared components.
- Prefer `*.module.css` for local styles (vite CSS Modules, hashed class names); plain `.css` is covered by the prefix scoping.
- Follow the host theme via `:root` / `.dark` CSS variables; don't fight the theme with hardcoded light colors in dark mode.
- **Keep dark scrollbars dark** — do not override the host's dark `::-webkit-scrollbar` with light colors.
- **Dialog content area: `max-width: 100%; overflow: hidden;`** so long content never blows out the dialog or creates double scrollbars.
- Dark-mode text brightness ≥ `#8A8A96` for readability.

### 2.5 Files

- Keep the renderer under `src/renderer/` (`App.tsx` default export = the view, `i18n.ts`, `styles.css`, `env.d.ts`).
- Import `./i18n` in `App.tsx` before using `t()`.

## 3. General

- `manifest`: `type` defaults to `app` — declare explicitly when different; output is a plain `dist/` (no asar / plugin.json); `description`/`icon` are required.
- After any source change, run the full build (`npm run build`) so `dist` matches the sources before handoff/testing.
- Verify permissions end-to-end in a dev run; use the escape vars only temporarily, never in production builds.
