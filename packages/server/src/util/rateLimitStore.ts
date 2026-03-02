export type RateWindow = {
  windowStartMs: number;
  count: number;
};

function touchRateLimitKey<K extends string>(
  store: Map<K, RateWindow>,
  key: K,
  value: RateWindow,
): void {
  store.delete(key);
  store.set(key, value);
}

export function pruneExpiredFixedWindowEntries<K extends string>(
  store: Map<K, RateWindow>,
  nowMs: number,
  windowMs: number,
): void {
  for (const [key, window] of store) {
    if (nowMs - window.windowStartMs < windowMs) return;
    store.delete(key);
  }
}

export function evictOldestEntries<K extends string>(
  store: Map<K, RateWindow>,
  maxTrackedKeys: number,
): void {
  if (maxTrackedKeys <= 0) {
    store.clear();
    return;
  }

  const overflow = store.size - maxTrackedKeys;
  if (overflow <= 0) return;

  let evicted = 0;
  const keysToDelete: K[] = [];
  for (const key of store.keys()) {
    keysToDelete.push(key);
    evicted += 1;
    if (evicted >= overflow) break;
  }
  for (const key of keysToDelete) store.delete(key);
}

export function boundFixedWindowRateLimitStore<K extends string>(
  store: Map<K, RateWindow>,
  nowMs: number,
  options: { windowMs: number; maxTrackedKeys: number },
): void {
  pruneExpiredFixedWindowEntries(store, nowMs, options.windowMs);
  evictOldestEntries(store, options.maxTrackedKeys);
}

export function checkFixedWindowRateLimit<K extends string>(
  key: K,
  store: Map<K, RateWindow>,
  options: { windowMs: number; maxCount: number; maxTrackedKeys: number },
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  boundFixedWindowRateLimitStore(store, now, {
    windowMs: options.windowMs,
    maxTrackedKeys: options.maxTrackedKeys,
  });
  const window = store.get(key);

  if (!window || now - window.windowStartMs >= options.windowMs) {
    touchRateLimitKey(store, key, { windowStartMs: now, count: 1 });
    return { allowed: true };
  }

  if (window.count >= options.maxCount) {
    const retryAfterMs = Math.max(0, options.windowMs - (now - window.windowStartMs));
    touchRateLimitKey(store, key, window);
    return { allowed: false, retryAfterMs };
  }

  touchRateLimitKey(store, key, { windowStartMs: window.windowStartMs, count: window.count + 1 });
  return { allowed: true };
}
