const BASE64_CHAR_REGEX = /^[A-Za-z0-9+/]$/;

function countPadding(value: string): number {
  if (value.endsWith("==")) return 2;
  if (value.endsWith("=")) return 1;
  return 0;
}

function isBase64Char(char: string): boolean {
  return BASE64_CHAR_REGEX.test(char);
}

function validateBodyChars(value: string, bodyLength: number): boolean {
  for (let i = 0; i < bodyLength; i += 1) {
    if (!isBase64Char(value[i] ?? "")) return false;
  }
  return true;
}

export function base64DecodedBytesLength(value: string): number | null {
  const len = value.length;
  if (len % 4 !== 0) return null;

  const padding = countPadding(value);
  const bodyLength = len - padding;
  if (!validateBodyChars(value, bodyLength)) return null;

  return (len * 3) / 4 - padding;
}
