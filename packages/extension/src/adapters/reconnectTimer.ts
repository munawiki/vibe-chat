export type ReconnectTimer = NodeJS.Timeout;

export function scheduleReconnectTimer(delayMs: number, fn: () => void): ReconnectTimer {
  return setTimeout(fn, delayMs);
}

export function cancelReconnectTimer(timer: ReconnectTimer | undefined): void {
  if (!timer) return;
  clearTimeout(timer);
}
