# VS Code Chat

A VS Code extension that lets you join a single shared chat room using GitHub sign-in.

This repository also includes an optional Cloudflare Workers + Durable Objects backend used by the extension.

## Configuration

- `vscodeChat.backendUrl` (default: `http://127.0.0.1:8787`)
- `vscodeChat.autoConnect` (default: `true`)

## Privacy & Telemetry

- The extension does **not** expose GitHub access tokens to the webview.
- The backend does **not** persist GitHub access tokens.
- The extension emits minimal, privacy-preserving telemetry only when VS Code telemetry is enabled.
  - See `telemetry.json` for the machine-readable list of events.
