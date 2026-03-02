export function parseBearerToken(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1] || undefined;
}

export function getClientIp(request: Request): string | undefined {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return undefined;

  const first = forwardedFor.split(",")[0]?.trim();
  return first || undefined;
}
