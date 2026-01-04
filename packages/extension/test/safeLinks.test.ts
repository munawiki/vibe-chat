import { describe, expect, it } from "vitest";
import { normalizeExternalHref } from "../src/contract/safeLinks.js";

describe("safeLinks", () => {
  it("allows http(s) and trims whitespace", () => {
    expect(normalizeExternalHref(" https://example.com ")).toBe("https://example.com/");
  });

  it("normalizes www.* to https", () => {
    expect(normalizeExternalHref("www.example.com")).toBe("https://www.example.com/");
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeExternalHref("javascript:alert(1)")).toBeNull();
  });
});
