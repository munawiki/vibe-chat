export type ReadBoundedBodyError = "too_large" | "timeout" | "read_error";

export type ReadBoundedBodyResult<TChunk> =
  | { ok: true; chunks: TChunk[]; bytes: number }
  | { ok: false; error: ReadBoundedBodyError; chunks: TChunk[]; bytes: number };

export async function readBoundedBody<TChunk>(options: {
  source: AsyncIterable<TChunk>;
  maxBytes: number;
  timeoutMs: number;
  chunkByteLength: (chunk: TChunk) => number;
}): Promise<ReadBoundedBodyResult<TChunk>> {
  const chunks: TChunk[] = [];
  let bytes = 0;

  const iterator = options.source[Symbol.asyncIterator]();
  const timeoutPromise = createTimeoutPromise(options.timeoutMs);

  try {
    while (true) {
      const next = await Promise.race<IteratorResult<TChunk, unknown> | { timeout: true }>([
        iterator.next(),
        timeoutPromise.promise,
      ]);
      if ("timeout" in next) {
        await safeReturn(iterator);
        return { ok: false, error: "timeout", chunks, bytes };
      }

      if (next.done) break;
      if (next.value === undefined) continue;

      const size = options.chunkByteLength(next.value);
      bytes += size;
      chunks.push(next.value);
      if (bytes > options.maxBytes) {
        await safeReturn(iterator);
        return { ok: false, error: "too_large", chunks, bytes };
      }
    }

    return { ok: true, chunks, bytes };
  } catch {
    return { ok: false, error: "read_error", chunks, bytes };
  } finally {
    timeoutPromise.clear();
  }
}

function createTimeoutPromise(timeoutMs: number): {
  promise: Promise<{ timeout: true }>;
  clear: () => void;
} {
  const handle = setTimeout(() => resolve({ timeout: true }), timeoutMs);
  let resolve: (value: { timeout: true }) => void = () => {};
  const promise = new Promise<{ timeout: true }>((res) => {
    resolve = res;
  });

  return {
    promise,
    clear: () => clearTimeout(handle),
  };
}

async function safeReturn<TChunk>(iterator: AsyncIterator<TChunk>): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // no-op
  }
}
