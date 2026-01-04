import { describe, expect, it } from "vitest";
import { tokenizeMessageText } from "../src/contract/messageRendering.js";

describe("messageRendering", () => {
  it("tokenizes fenced code blocks and excludes the info string line", () => {
    const tokens = tokenizeMessageText("before\n```ts\nconst x = 1;\n```\nafter");
    expect(tokens.map((t) => t.kind)).toEqual(["text", "codeBlock", "text"]);
    expect(tokens[1]).toEqual({ kind: "codeBlock", text: "const x = 1;\n", languageHint: "ts" });
  });

  it("treats unclosed fences as plain text", () => {
    const tokens = tokenizeMessageText("before\n```\ncode");
    expect(tokens.map((t) => t.kind)).toEqual(["text"]);
    expect(tokens[0]).toEqual({ kind: "text", text: "before\n```\ncode" });
  });

  it("tokenizes links but does not linkify inside code blocks", () => {
    const tokens = tokenizeMessageText("See https://example.com\n```\nhttps://example.com\n```");
    expect(tokens.some((t) => t.kind === "link")).toBe(true);
    expect(tokens.filter((t) => t.kind === "codeBlock")).toEqual([
      { kind: "codeBlock", text: "https://example.com\n", languageHint: null },
    ]);
  });

  it("normalizes www.* links to https", () => {
    const tokens = tokenizeMessageText("www.example.com");
    expect(tokens).toEqual([
      { kind: "link", text: "www.example.com", href: "https://www.example.com/" },
    ]);
  });

  it("does not emit javascript: links", () => {
    const tokens = tokenizeMessageText("javascript:alert(1)");
    expect(tokens.map((t) => t.kind)).toEqual(["text"]);
  });
});
