# @vscode-chat/server

Cloudflare Workers + Durable Objects backend for VS Code Chat.

## Local development

1. `cp .dev.vars.example .dev.vars`
2. Set `SESSION_SECRET` (>= 32 characters)
3. `npm run dev`

## Deploy

1. `npx wrangler login`
2. `npx wrangler secret put SESSION_SECRET`
3. `npm run deploy`
