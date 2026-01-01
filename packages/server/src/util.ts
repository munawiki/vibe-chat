export type RateWindow = {
  windowStartMs: number;
  count: number;
};

export function checkFixedWindowRateLimit(
  key: string,
  store: Map<string, RateWindow>,
  options: { windowMs: number; maxCount: number },
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const window = store.get(key);

  if (!window || now - window.windowStartMs >= options.windowMs) {
    store.set(key, { windowStartMs: now, count: 1 });
    return { allowed: true };
  }

  if (window.count >= options.maxCount) {
    const retryAfterMs = Math.max(0, options.windowMs - (now - window.windowStartMs));
    return { allowed: false, retryAfterMs };
  }

  window.count += 1;
  store.set(key, window);
  return { allowed: true };
}

export function parseBearerToken(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1] || undefined;
}

export function parseGithubUserIdDenylist(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

export function getClientIp(request: Request): string | undefined {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return undefined;

  const first = forwardedFor.split(",")[0]?.trim();
  return first || undefined;
}
