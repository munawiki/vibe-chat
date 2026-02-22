import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  backendUrl: "https://example.test///",
  autoConnect: true,
  nextSession: undefined as undefined | { account: { id: string }; accessToken: string },
  changeListener: undefined as undefined | ((e: { provider: { id: string } }) => void),
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue?: unknown) => {
        if (key === "backendUrl") return harness.backendUrl;
        if (key === "autoConnect") return harness.autoConnect;
        return defaultValue;
      },
    }),
  },
  authentication: {
    getSession: () => Promise.resolve(harness.nextSession),
    onDidChangeSessions: (listener: (e: { provider: { id: string } }) => void) => {
      harness.changeListener = listener;
      return { dispose: () => {} };
    },
  },
}));

import { getBackendUrl, autoConnectEnabled } from "../src/adapters/vscodeConfig.js";
import { getGitHubSession, onDidChangeGitHubSessions } from "../src/adapters/vscodeAuth.js";

describe("vscodeConfig", () => {
  it("trims trailing slashes from backendUrl", () => {
    harness.backendUrl = "https://example.test///";
    expect(getBackendUrl()).toBe("https://example.test");
  });

  it("reads autoConnect with default true", () => {
    harness.autoConnect = false;
    expect(autoConnectEnabled()).toBe(false);
  });
});

describe("vscodeAuth", () => {
  it("gets a GitHub session (interactive and silent)", async () => {
    harness.nextSession = undefined;
    expect(await getGitHubSession({ interactive: false })).toBeUndefined();

    harness.nextSession = { account: { id: "acct" }, accessToken: "token" };
    const session = await getGitHubSession({ interactive: true });
    expect(session.githubAccountId).toBe("acct");
    expect(session.accessToken).toBe("token");
  });

  it("forwards GitHub session change events", () => {
    const listener = vi.fn();
    onDidChangeGitHubSessions(listener);

    harness.changeListener?.({ provider: { id: "other" } });
    expect(listener).toHaveBeenCalledTimes(0);

    harness.changeListener?.({ provider: { id: "github" } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
