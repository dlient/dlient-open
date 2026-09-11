# @dlient-open/create-plugin

Scaffold for **dlient** plugins. One command creates a plugin project that builds into a `.dlient` package and imports into the open-source dlient host.

> **English** · [简体中文](README.zh-CN.md)

## Quick start

```bash
npx @dlient-open/create-plugin my-plugin

cd my-plugin
npm install          # the scaffold does NOT install or init git for you
npm run dev          # watch build while developing
npm run build        # build UI (remoteEntry) + worker
npm run pack         # → my-plugin-0.1.0.dlient
```

Then open **dlient** → **Import plugin** → pick the generated `.dlient`.

## Usage

```
npx @dlient-open/create-plugin <plugin-id> [options]
```

`<plugin-id>` must be lowercase letters / digits / hyphens and start with a letter (e.g. `my-plugin`).

| Option | Description |
|--------|-------------|
| `--name "<display name>"` | Plugin display name (defaults to the id) |
| `--dir <path>` | Directory to create the project in (defaults to the current directory) |
| `--native-host` | Native modules carried by an official Node child process (`dlient.nativeModules` + `@dlient-open/native-host-sdk`) — no rebuild needed |
| `--native` | Native modules via vendored prebuilds + `@electron/rebuild` (built per platform) |

`--skip-install` and `--no-git` are accepted for compatibility and do nothing — this CLI never installs dependencies or initializes a repository.

## What you get

```
my-plugin/
├─ .agent/                Development docs for AI coding assistants (English)
├─ assets/                icon.svg · index.md / index.en-US.md / index.zh-CN.md (user-facing docs) · mcp.json
├─ skills/SKILL.md        The agent skill this plugin provides
├─ src/
│  ├─ main/index.ts       Worker (Node): RPC handlers
│  └─ renderer/App.tsx    UI (React + Vite)
├─ script/                build-clean.mjs · build-worker.mjs · make-dlient.mjs
└─ package.json           dlient manifest (`dlient` object) + scripts
```

Notes:

- `assets/index.md` / `index.en-US.md` are generated from the project `README.md`; `assets/index.zh-CN.md` from `README.cn.md`. They are what users see on the plugin's detail page.
- `.agent/` holds the plugin-development documentation (host-api, manifest schema, UI kit, worker model). Point your AI assistant at it — `AGENTS.md` explains how.
- The generated `package.json` already declares `files: ["dist", "assets", "script", "*.dlient"]` and `prepublishOnly: "npm run pack"`, so publishing always ships a fresh `.dlient`.

## Publishing

- **Local distribution** — `npm run pack` writes `<id>-<version>.dlient` next to the project. The open-source host does not verify signatures, so the package imports as-is.
- **npm** — bump `version`, then `npm publish`. Two conventions matter:
  - `keywords` **must include `dlient-open-plugin`** — this keyword is reserved for plugin packages (the plugin marketplace searches by it), and must not be used by non-plugin packages.
  - keep the `.dlient` inside the published package (the `files` field already does) — the host installs from the `.dlient` contained in the npm tarball.

## Requirements

Node.js ≥ 18 (npm ships with it). Nothing needs to be installed globally.

## Development

Template changes live in `templates/plugin-demo/`. To verify them, run the CLI from this directory (`node bin/cli.mjs demo-plugin --dir <tmp>`) and inspect the generated project.

```bash
npm run prepare:templates   # check the template is in place
npm run pack                # npm pack (tarball for local inspection)
```
