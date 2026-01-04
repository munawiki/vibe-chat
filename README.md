# Vibe Chat

A VS Code extension that lets you join a single shared chat room using GitHub sign-in. Includes a Cloudflare Workers + Durable Objects backend.

## Requirements

- Node.js 20+
- Cloudflare account (only for deploying the backend)

## Development

- `pnpm install`
- `pnpm dev` (starts backend + extension watch; bootstraps `packages/server/.dev.vars` if needed)
- In VS Code, run the `Run Extension (Vibe Chat)` launch config (F5). It will run the `Dev: All` task automatically.

## Configuration

- `vscodeChat.backendUrl` (default: `https://vscode-chat.munawiki.workers.dev`)
  - For local development: `http://127.0.0.1:8787`
- `vscodeChat.autoConnect` (default: `true`)

## Quality gate

- `pnpm check`

## License

Apache-2.0
