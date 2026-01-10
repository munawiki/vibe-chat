# Changelog

## 0.0.7

- Add `Vibe Chat: Sign out` (command palette + profile action).
- Scope DM keys/trusted peers per GitHub account to avoid cross-account mixups.
- Improve modal overlay UX (single active overlay, Escape closes).

## 0.0.6

- Add optimistic outbox for new messages (shows pending state and send errors).
- Correlate outbound sends with server events using `clientMessageId` for better UX.

## 0.0.5

- Improve connection reliability with a WebSocket heartbeat.
- Fix unread badge syncing after the UI is ready.
- Make author login names behave like links.

## 0.0.4

- Fix composer stretching when optional panels are hidden.

## 0.0.3

- Fix composer sizing when VS Code provides unitless line-height.
- Add marketplace icon (PNG) generated from `media/icon.svg`.

## 0.0.2

- Rebrand to Vibe Chat.

## 0.0.1

- Initial preview release.
