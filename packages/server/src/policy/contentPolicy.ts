const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;
const STRIP_RE = /[\p{Z}\p{P}\p{S}]/gu;

export function normalizeContentText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(ZERO_WIDTH_RE, "").replace(STRIP_RE, "");
}

export function compileDenylist(denylist: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const compiled: string[] = [];
  for (const term of denylist) {
    const normalized = normalizeContentText(term);
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    compiled.push(normalized);
  }
  return compiled;
}

export function buildCompiledDenylist(options: {
  presetDenylist: ReadonlyArray<string>;
  extraDenylist: ReadonlyArray<string>;
  allowlist: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const allow = new Set(compileDenylist(options.allowlist));
  const combined = compileDenylist([...options.presetDenylist, ...options.extraDenylist]);
  if (allow.size === 0) return combined;
  return combined.filter((term) => !allow.has(term));
}

export function violatesDenylist(text: string, compiledDenylist: ReadonlyArray<string>): boolean {
  if (compiledDenylist.length === 0) return false;
  const normalized = normalizeContentText(text);
  if (normalized.length === 0) return false;

  for (const term of compiledDenylist) {
    if (normalized.includes(term)) return true;
  }
  return false;
}
