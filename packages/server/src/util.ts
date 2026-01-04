import { GithubUserIdSchema, type GithubUserId } from "@vscode-chat/protocol";

export type RateWindow = {
  windowStartMs: number;
  count: number;
};

export type ReadRequestJsonError = "too_large" | "invalid_json" | "timeout" | "read_error";

function touchRateLimitKey<K extends string>(
  store: Map<K, RateWindow>,
  key: K,
  value: RateWindow,
): void {
  // Invariant: Map iteration order is treated as LRU (oldest-first) for pruning/eviction.
  // Touching a key MUST move it to the end so expired windows cluster at the front.
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

export function parseBearerToken(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1] || undefined;
}

export function parseGithubUserIdList(
  value: string | undefined,
  options?: { key?: string },
): Set<GithubUserId> {
  return parseGithubUserIdListInternal(value, options?.key);
}

export function parseGithubUserIdDenylist(value: string | undefined): Set<GithubUserId> {
  return parseGithubUserIdList(value, { key: "DENY_GITHUB_USER_IDS" });
}

export function getClientIp(request: Request): string | undefined {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return undefined;

  const first = forwardedFor.split(",")[0]?.trim();
  return first || undefined;
}

export async function readRequestJsonWithLimit(
  request: Request,
  options: { maxBytes: number; timeoutMs: number },
): Promise<{ ok: true; json: unknown } | { ok: false; error: ReadRequestJsonError }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > options.maxBytes) {
      return { ok: false, error: "too_large" };
    }
  }

  const body = request.body;
  if (!body) return { ok: false, error: "invalid_json" };

  const reader = body.getReader();

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {
      // ignore
    });
  }, options.timeoutMs);

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > options.maxBytes) {
        void reader.cancel().catch(() => {
          // ignore
        });
        return { ok: false, error: "too_large" };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, error: timedOut ? "timeout" : "read_error" };
  } finally {
    clearTimeout(timeout);
  }

  if (chunks.length === 0) return { ok: false, error: "invalid_json" };

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder().decode(buffer).trim();
  if (text.length === 0) return { ok: false, error: "invalid_json" };

  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function parseGithubUserIdListInternal(value: string | undefined, key?: string): Set<GithubUserId> {
  if (!value) return new Set();

  const parts = value
    .split(/[,\n]/g)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const ids = new Set<GithubUserId>();
  for (const id of parts) {
    const parsed = GithubUserIdSchema.safeParse(id);
    if (!parsed.success) {
      const label = key ?? "GitHub user id list";
      throw new Error(`${label} must be a comma-separated list of GitHub numeric user ids.`);
    }
    ids.add(parsed.data);
  }

  return ids;
}
