---
name: "__PLUGIN_ID__"
description: "Template demo plugin: exposes an example greet method that returns a greeting message. Invoke when testing the plugin scaffolding or demonstrating a minimal dlient plugin."
---

# __PLUGIN_ID__ — Template App

This is a dlient plugin template created by the scaffold. It demonstrates the minimal structure of a dlient plugin (UI + worker) and exposes one example method.

## When to Use

- Test / validate the plugin development workflow.
- Demonstrate how a minimal dlient plugin is structured and called.

## Methods

| Method | Args | Returns | Description |
|--------|------|---------|-------------|
| `__PLUGIN_ID__.greet` | — | `string` | Return a greeting message |
| `__PLUGIN_ID__.echo` | — | error envelope | Business-error example (`rpc.error` + localized message) |
| `__PLUGIN_ID__.guard` | — | error envelope | Throwing `PluginError` example (the SDK wraps it into a failure envelope) |

## Example

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet')
```

## Exposure policy

- **Expose as little as possible.** Delete the demo `expose` entries (and their `rpc.registerHandler(...)`
  calls) unless another plugin really has to call this plugin, or the user explicitly asks for it.
- A plugin can expose methods **only if it actually ships a worker** — i.e. its build output contains
  `dist/worker.js`. The manifest `type` is irrelevant: an `app` / `ui` plugin that ships `dist/worker.js` can
  expose too, while a plugin without it cannot serve the call (`WORKER_NOT_RUNNING`, `-2102`).
- If you do expose something, prefer to also expose the reserved `grant` handler (recommended, not required)
  and prefer returning `ask`; return `deny` for methods that touch user privacy, passwords, keys or tokens.
  See `.agent/references/worker.md` § Exposing methods to other plugins for the contract and a code example.

## Secrets

- Never store passwords, keys or tokens in plain text. Encrypt them through the host
  (`rpc.app.crypt.encrypt` before writing, `rpc.app.crypt.decrypt` after reading; permission `app.crypt`)
  before putting them into `app.data` (plaintext on disk), and never log or return them in plaintext.
  See `.agent/references/permission-model.md` § Secret storage.

## Notes

- This is a dev demo plugin (`source: 'dev'`); it is not published to the market.
