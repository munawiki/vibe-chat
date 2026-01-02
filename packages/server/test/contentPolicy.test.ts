import { describe, expect, it } from "vitest";
import {
  buildCompiledDenylist,
  compileDenylist,
  normalizeContentText,
  violatesDenylist,
} from "../src/policy/contentPolicy.js";

describe("content policy", () => {
  it("normalizes text for denylist matching", () => {
    expect(normalizeContentText("Ｆ u-c\u200Bk")).toBe("fuck");
  });

  it("compiles denylist by normalizing and de-duplicating", () => {
    expect(compileDenylist(["ＦＵＣＫ", "fuck", "  "])).toEqual(["fuck"]);
  });

  it("detects denylisted terms even when obfuscated", () => {
    const denylist = compileDenylist(["fuck", "bad"]);
    expect(violatesDenylist("f u c k", denylist)).toBe(true);
    expect(violatesDenylist("b\u200Ba\u200Bd", denylist)).toBe(true);
    expect(violatesDenylist("hello world", denylist)).toBe(false);
  });

  it("removes allowlisted terms from the compiled denylist", () => {
    const denylist = buildCompiledDenylist({
      presetDenylist: ["bad"],
      extraDenylist: ["evil"],
      allowlist: ["BAD"],
    });
    expect(denylist).toEqual(["evil"]);
  });
});
