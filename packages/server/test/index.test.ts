import { describe, expect, it, vi } from "vitest";
import type { GithubUserId } from "@vscode-chat/protocol";

vi.mock("../src/session.js", () => ({
  exchangeGithubTokenForSession: () =>
    Promise.resolve({
      token: "backend-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: {
        githubUserId: "1" as GithubUserId,
        login: "alice",
        avatarUrl: "https://example.test/alice.png",
      },
    }),
}));

import worker from "../src/index.js";
import { createMockEnv } from "./helpers/mockEnv.js";

describe("worker fetch", () => {
  it("serves /health and 404s unknown paths", async () => {
    const env = createMockEnv();

    const health = await worker.fetch(new Request("https://example.test/health"), env);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const missing = await worker.fetch(new Request("https://example.test/nope"), env);
    expect(missing.status).toBe(404);
  });

  it("rejects invalid config", async () => {
    const env = createMockEnv({ CHAT_MESSAGE_RATE_WINDOW_MS: "0" });
    const res = await worker.fetch(new Request("https://example.test/health"), env);
    expect(res.status).toBe(500);
  });

  it("handles /auth/exchange", async () => {
    const env = createMockEnv();

    const method = await worker.fetch(new Request("https://example.test/auth/exchange"), env);
    expect(method.status).toBe(405);

    const tooLarge = await worker.fetch(
      new Request("https://example.test/auth/exchange", {
        method: "POST",
        headers: { "content-length": "999999" },
        body: "{}",
      }),
      env,
    );
    expect(tooLarge.status).toBe(413);

    const invalidJson = await worker.fetch(
      new Request("https://example.test/auth/exchange", {
        method: "POST",
        body: "{",
      }),
      env,
    );
    expect(invalidJson.status).toBe(400);

    const invalidPayload = await worker.fetch(
      new Request("https://example.test/auth/exchange", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(invalidPayload.status).toBe(400);

    const ok = await worker.fetch(
      new Request("https://example.test/auth/exchange", {
        method: "POST",
        body: JSON.stringify({ accessToken: "gh" }),
      }),
      env,
    );
    expect(ok.status).toBe(200);
    const json: { token: string } = await ok.json();
    expect(json.token).toBe("backend-token");
  });

  it("handles /telemetry", async () => {
    const env = createMockEnv();

    const method = await worker.fetch(new Request("https://example.test/telemetry"), env);
    expect(method.status).toBe(405);

    const invalidJson = await worker.fetch(
      new Request("https://example.test/telemetry", {
        method: "POST",
        body: "{",
      }),
      env,
    );
    expect(invalidJson.status).toBe(400);

    const invalidPayload = await worker.fetch(
      new Request("https://example.test/telemetry", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(invalidPayload.status).toBe(400);

    const ok = await worker.fetch(
      new Request("https://example.test/telemetry", {
        method: "POST",
        body: JSON.stringify({ name: "vscodeChat.auth.exchange", outcome: "success" }),
      }),
      env,
    );
    expect(ok.status).toBe(204);

    const fallbackOk = await worker.fetch(
      new Request("https://example.test/telemetry", {
        method: "POST",
        body: JSON.stringify({
          name: "vscodeChat.ws.legacy_fallback",
          fallback: "handshake_429_body",
          kind: "too_many_connections",
        }),
      }),
      env,
    );
    expect(fallbackOk.status).toBe(204);
  });

  it("proxies /ws to the chat room durable object", async () => {
    const env = createMockEnv();

    const notWs = await worker.fetch(new Request("https://example.test/ws"), env);
    expect(notWs.status).toBe(426);

    const upgraded = await worker.fetch(
      new Request("https://example.test/ws", { headers: { Upgrade: "websocket" } }),
      env,
    );
    expect(upgraded.status).toBe(200);
    expect(await upgraded.text()).toBe("proxied");
  });
});
