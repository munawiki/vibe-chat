export function normalizeExternalHref(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  const candidate = trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  return url.toString();
}
