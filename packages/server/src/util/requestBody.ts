import { readBoundedBody } from "@vscode-chat/protocol";

export type ReadRequestJsonError = "too_large" | "invalid_json" | "timeout" | "read_error";

export async function readRequestJsonWithLimit(
  request: Request,
  options: { maxBytes: number; timeoutMs: number },
): Promise<{ ok: true; json: unknown } | { ok: false; error: ReadRequestJsonError }> {
  if (isContentLengthTooLarge(request.headers.get("content-length"), options.maxBytes)) {
    return { ok: false, error: "too_large" };
  }

  const bodyBytes = await readRequestBodyBytesWithLimit(request.body, options);
  if (!bodyBytes.ok) return bodyBytes;

  const text = decodeRequestBodyText(bodyBytes.bytes);
  if (!text) return { ok: false, error: "invalid_json" };

  return parseJsonText(text);
}

function isContentLengthTooLarge(contentLength: string | null, maxBytes: number): boolean {
  if (!contentLength) return false;
  const length = Number(contentLength);
  return Number.isFinite(length) && length > maxBytes;
}

function concatChunks(chunks: Uint8Array[], bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

async function readRequestBodyBytesWithLimit(
  body: ReadableStream<Uint8Array> | null,
  options: { maxBytes: number; timeoutMs: number },
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: ReadRequestJsonError }> {
  if (!body) return { ok: false, error: "invalid_json" };

  const reader = body.getReader();
  const bounded = await readBoundedBody({
    source: streamReaderToAsyncIterable(reader),
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    chunkByteLength: (chunk) => chunk.byteLength,
  });
  if (!bounded.ok) {
    return { ok: false, error: bounded.error };
  }
  if (bounded.chunks.length === 0) return { ok: false, error: "invalid_json" };
  return { ok: true, bytes: concatChunks(bounded.chunks, bounded.bytes) };
}

function decodeRequestBodyText(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(bytes).trim();
  return text.length > 0 ? text : undefined;
}

function parseJsonText(
  text: string,
): { ok: true; json: unknown } | { ok: false; error: ReadRequestJsonError } {
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

async function* streamReaderToAsyncIterable(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<Uint8Array, void, void> {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value) continue;
      yield value;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
