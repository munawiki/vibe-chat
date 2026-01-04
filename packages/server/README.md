# @vscode-chat/server

Cloudflare Workers + Durable Objects backend for Vibe Chat.

## Local development

From the repo root:

1. `pnpm install`
2. `pnpm dev`

Backend-only (from this folder):

1. `cp .dev.vars.example .dev.vars`
2. Set `SESSION_SECRET` (>= 32 characters)
3. `pnpm dev`

## Configuration

Optional environment variables allow bounding resource usage and cost:

- `CHAT_MESSAGE_RATE_WINDOW_MS`, `CHAT_MESSAGE_RATE_MAX_COUNT` (per-user message rate limit)
- `CHAT_CONNECT_RATE_WINDOW_MS`, `CHAT_CONNECT_RATE_MAX_COUNT` (per-IP connection attempt rate limit)
- `CHAT_MAX_CONNECTIONS_PER_USER` (per-user concurrent connections)
- `CHAT_MAX_CONNECTIONS_PER_ROOM` (room-wide concurrent connections)
- `CHAT_HISTORY_LIMIT` (recent message history size)
- `CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES` (history persistence frequency)

Optional environment variables allow minimal abuse controls:

- `DENY_GITHUB_USER_IDS` (comma-separated GitHub numeric user ids denied at the WebSocket boundary)
- `MODERATOR_GITHUB_USER_IDS` (comma-separated GitHub numeric user ids granted the `moderator` role)

Optional environment variables allow enforcing a denylist-based content policy:

- `CHAT_CONTENT_FILTER_MODE` (`off` | `reject`)
- `CHAT_CONTENT_FILTER_LANGUAGES` (comma/newline-separated language codes, or `all`)
- `CHAT_CONTENT_DENYLIST` (comma/newline-separated extra terms)
- `CHAT_CONTENT_ALLOWLIST` (comma/newline-separated allowlist terms)

See `.dev.vars.example` for recommended defaults and operational guidance.
