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

## Example

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet')
```

## Notes

- This is a dev demo plugin (`source: 'dev'`); it is not published to the market.
