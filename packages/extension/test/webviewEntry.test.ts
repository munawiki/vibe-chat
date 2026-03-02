// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("webview entry boundary", () => {
  const globals = globalThis as { __VSCODE_CHAT_WEBVIEW_TEST__?: boolean };
  let previousFlag: boolean | undefined;

  beforeEach(() => {
    previousFlag = globals.__VSCODE_CHAT_WEBVIEW_TEST__;
    globals.__VSCODE_CHAT_WEBVIEW_TEST__ = true;
    document.body.innerHTML = "";
  });

  afterEach(() => {
    globals.__VSCODE_CHAT_WEBVIEW_TEST__ = previousFlag;
    vi.resetModules();
  });

  it("renders a visible boot error when initialization throws", async () => {
    const mod = await import("../webview-src/webview.js");
    await mod.bootWebview(() => Promise.reject(new Error("forced init failure")));

    const pre = document.body.querySelector("pre");
    expect(pre?.textContent).toContain("Webview initialization failed.");
    expect(pre?.textContent).toContain("forced init failure");
  });

  it("does not render boot error when initialization succeeds", async () => {
    const mod = await import("../webview-src/webview.js");
    await mod.bootWebview(() => Promise.resolve(undefined));

    const pre = document.body.querySelector("pre");
    expect(pre).toBeNull();
  });
});
