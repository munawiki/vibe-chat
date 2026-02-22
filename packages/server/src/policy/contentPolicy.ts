const STRIP_RE = /[\p{Z}\p{P}\p{S}]/gu;

const ZERO_WIDTH_CHARS = ["\u200B", "\u200C", "\u200D", "\uFEFF"] as const;

function stripZeroWidth(text: string): string {
  let out = text;
  for (const ch of ZERO_WIDTH_CHARS) {
    out = out.replaceAll(ch, "");
  }
  return out;
}

export function normalizeContentText(text: string): string {
  return stripZeroWidth(text.normalize("NFKC").toLowerCase()).replaceAll(STRIP_RE, "");
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
