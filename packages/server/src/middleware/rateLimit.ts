import { json } from "../http.js";
import { getClientIp } from "../util/headers.js";
import { checkFixedWindowRateLimit, type RateWindow } from "../util/rateLimitStore.js";

export function enforceFixedWindowRateLimit(
  request: Request,
  store: Map<string, RateWindow>,
  config: {
    windowMs: number;
    maxCount: number;
    maxTrackedKeys: number;
    noStore?: boolean;
  },
): Response | undefined {
  const clientIp = getClientIp(request);
  if (!clientIp) return undefined;

  const rateCheck = checkFixedWindowRateLimit(clientIp, store, config);
  if (rateCheck.allowed) return undefined;

  const retryAfterSeconds = Math.ceil(rateCheck.retryAfterMs / 1000);
  return json({ error: "rate_limited", retryAfterMs: rateCheck.retryAfterMs }, 429, {
    ...(config.noStore ? { "cache-control": "no-store" } : {}),
    "retry-after": String(retryAfterSeconds),
  });
}
