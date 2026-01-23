# Sidekick

Sidekick is a desktop client for Codex-style agent workflows. This repo includes a Tauri + React UI, a local host bridge, shared types, and a transport adapter interface.

## Structure

- `apps/desktop` - Tauri + React UI
- `apps/host` - Node.js host service (HTTP + WebSocket)
- `packages/shared-types` - Shared TypeScript models
- `packages/transport-codex-appserver` - Adapter interface for Codex app-server

## Quickstart (host mode)

The desktop app connects to the host by default. Use mock mode only when you want to demo the UI without a running host.

```
pnpm install
pnpm --filter @sidekick/desktop dev
```

Set `VITE_SIDEKICK_MOCK=1` to force mock events.

## Run host + UI

```
pnpm install
pnpm --filter @sidekick/host dev
pnpm --filter @sidekick/desktop dev
```

## Run desktop shell (Tauri)

This launches the native desktop window instead of the browser. You need the Rust toolchain installed.

```
pnpm --filter @sidekick/desktop dev:tauri
```

The host listens on `http://localhost:8787` and streams events on `ws://localhost:8787/events`.

## Environment variables

- `VITE_SIDEKICK_MOCK` - set to `false` to use the host server
- `VITE_SIDEKICK_HOST` - override host base URL
- `VITE_SIDEKICK_WS` - override host WebSocket URL
- `SIDEKICK_HOST_PORT` - host listen port
- `SIDEKICK_DB_PATH` - host SQLite DB path
- `SIDEKICK_TRANSPORT` - transport mode (defaults to `mock`)

## Notes

- The host service currently ships with a mock transport that simulates plans, approvals, and command output.
- The transport adapter in `packages/transport-codex-appserver` is ready to be wired to a real `codex app-server` process.
