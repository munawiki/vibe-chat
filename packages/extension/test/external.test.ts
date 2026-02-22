import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  opened: [] as string[],
}));

vi.mock("vscode", () => ({
  Uri: {
    parse: (value: string) => value,
  },
  env: {
    openExternal: (uri: string) => {
      harness.opened.push(uri);
      return Promise.resolve(true);
    },
  },
}));

import { openExternalHref, openGitHubProfileInBrowser } from "../src/ui/chatView/external.js";

describe("openExternalHref", () => {
  it("rejects unsupported schemes", async () => {
    const result = await openExternalHref("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  it("opens normalized urls", async () => {
    harness.opened.length = 0;
    const result = await openExternalHref("https://example.test/path");
    expect(result.ok).toBe(true);
    expect(harness.opened).toEqual(["https://example.test/path"]);
  });
});

describe("openGitHubProfileInBrowser", () => {
  it("no-ops on invalid login", async () => {
    harness.opened.length = 0;
    await openGitHubProfileInBrowser("not a login!");
    expect(harness.opened).toEqual([]);
  });

  it("opens the GitHub profile for valid login", async () => {
    harness.opened.length = 0;
    await openGitHubProfileInBrowser("octocat");
    expect(harness.opened).toEqual(["https://github.com/octocat"]);
  });
});
