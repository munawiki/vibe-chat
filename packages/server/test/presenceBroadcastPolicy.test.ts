import { describe, expect, it, vi } from "vitest";
import { PresenceBroadcastCoalescer } from "../src/policy/presenceBroadcastPolicy.js";

describe("PresenceBroadcastCoalescer", () => {
  it("coalesces multiple requests into a single flush within the window", () => {
    vi.useFakeTimers();

    const flush = vi.fn<(exclude: ReadonlySet<string>) => void>();
    const coalescer = new PresenceBroadcastCoalescer<string>(200, flush);

    coalescer.request();
    coalescer.request({ exclude: "a" });
    coalescer.request({ exclude: "b" });

    vi.advanceTimersByTime(199);
    expect(flush).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);

    const exclude = flush.mock.calls[0]?.[0];
    expect(exclude).toBeDefined();
    if (exclude) expect([...exclude].sort()).toEqual(["a", "b"]);

    vi.useRealTimers();
  });

  it("flushes at most once per window and schedules again after a flush", () => {
    vi.useFakeTimers();

    const flush = vi.fn();
    const coalescer = new PresenceBroadcastCoalescer<string>(200, flush);

    coalescer.request();
    vi.advanceTimersByTime(200);
    expect(flush).toHaveBeenCalledTimes(1);

    coalescer.request();
    coalescer.request();
    vi.advanceTimersByTime(200);
    expect(flush).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
