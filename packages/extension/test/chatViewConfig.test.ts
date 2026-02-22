import { describe, expect, it, vi } from "vitest";

const configHarness = vi.hoisted(() => ({
  throwOnGetConfiguration: false,
  backendUrl: "http://example.test",
  autoConnect: false,
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => {
      if (configHarness.throwOnGetConfiguration) throw new Error("boom");
      return {
        get: (key: string, defaultValue?: unknown) => {
          if (key === "backendUrl") return configHarness.backendUrl;
          if (key === "autoConnect") return configHarness.autoConnect;
          return defaultValue;
        },
      };
    },
  },
}));

describe("chat view config helpers", () => {
  it("reads vscodeChat config values", async () => {
    const { getBackendUrlFromConfig, isAutoConnectEnabledFromConfig } =
      await import("../src/ui/chatView/config.js");

    configHarness.throwOnGetConfiguration = false;
    configHarness.backendUrl = "http://example.test";
    configHarness.autoConnect = false;

    expect(getBackendUrlFromConfig()).toBe("http://example.test");
    expect(isAutoConnectEnabledFromConfig()).toBe(false);
  });

  it("falls back safely when config access throws", async () => {
    const { getBackendUrlFromConfig, isAutoConnectEnabledFromConfig } =
      await import("../src/ui/chatView/config.js");

    configHarness.throwOnGetConfiguration = true;

    expect(getBackendUrlFromConfig()).toBeUndefined();
    expect(isAutoConnectEnabledFromConfig()).toBe(true);
  });
});
