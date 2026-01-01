# @vscode-chat/server

Cloudflare Workers + Durable Objects backend for VS Code Chat.

## Local development

From the repo root:

1. `pnpm install`
2. `pnpm dev`

Backend-only (from this folder):

1. `cp .dev.vars.example .dev.vars`
2. Set `SESSION_SECRET` (>= 32 characters)
3. `pnpm dev`

## Deploy

From the repo root:

1. `pnpm --filter @vscode-chat/server exec wrangler login`
2. `pnpm --filter @vscode-chat/server exec wrangler secret put SESSION_SECRET`
3. `pnpm --filter @vscode-chat/server deploy`
