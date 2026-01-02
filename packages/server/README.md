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

## Configuration

Optional environment variables allow bounding resource usage and cost:

- `CHAT_MESSAGE_RATE_WINDOW_MS`, `CHAT_MESSAGE_RATE_MAX_COUNT` (per-user message rate limit)
- `CHAT_CONNECT_RATE_WINDOW_MS`, `CHAT_CONNECT_RATE_MAX_COUNT` (per-IP connection attempt rate limit)
- `CHAT_MAX_CONNECTIONS_PER_USER` (per-user concurrent connections)
- `CHAT_MAX_CONNECTIONS_PER_ROOM` (room-wide concurrent connections)
- `CHAT_HISTORY_LIMIT` (recent message history size)
- `CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES` (history persistence frequency)

See `.dev.vars.example` and `RUNBOOK.md` for recommended defaults and operational guidance.
