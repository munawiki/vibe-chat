# VS Code Chat

A VS Code extension that lets you join a single shared chat room using GitHub sign-in. Includes a Cloudflare Workers + Durable Objects backend.

## Requirements

- Node.js 20+
- Cloudflare account (only for deploying the backend)

## Development

- `npm ci`
- `npm run dev:server` (backend: `http://127.0.0.1:8787`)
- `npm run dev:extension` (extension bundler in watch mode)
- In VS Code, run the `Run Extension (VS Code Chat)` launch config.

## Configuration

- `vscodeChat.backendUrl` (default: `http://127.0.0.1:8787`)
- `vscodeChat.autoConnect` (default: `true`)

## Quality gate

- `npm run check`

## License

Apache-2.0
