import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { AuthUser, ServerEvent } from "@vscode-chat/protocol";
import type { ExtensionBus, ExtensionBusEvents } from "../src/bus/extensionBus.js";

vi.mock("vscode", () => ({ version: "1.90.0" }));

type WsOpenOptions = {
  wsUrl: string;
  token: string;
  onClose: (ws: unknown, code: number, reason: string) => void;
  onMessage: (ws: unknown, text: string) => void;
  onError: (ws: unknown, err: unknown) => void;
};

type WsHarness = {
  opened: number;
  sent: string[];
  lastOptions: WsOpenOptions | undefined;
  ws?: unknown;
  openImpl?: (
    options: WsOpenOptions,
  ) => Promise<{ ok: true; ws: unknown } | { ok: false; error: unknown }>;
};

const wsHarness: WsHarness = vi.hoisted(() => ({
  opened: 0,
  sent: [] as string[],
  lastOptions: undefined,
  ws: undefined,
  openImpl: undefined,
}));

vi.mock("../src/adapters/wsConnection.js", () => ({
  openWebSocket: (options: WsOpenOptions) => {
    if (wsHarness.openImpl) {
      return wsHarness.openImpl(options);
    }

    wsHarness.opened += 1;
    wsHarness.lastOptions = options;

    const ws = {
      readyState: 1,
      send: (data: string) => {
        wsHarness.sent.push(String(data));
      },
      close: () => {
        // no-op: tests drive close via the captured onClose callback
      },
    };

    wsHarness.ws = ws;
    return Promise.resolve({ ok: true as const, ws });
  },
}));

vi.mock("../src/adapters/wsHeartbeat.js", () => ({
  startWsHeartbeat: () => ({ stop: () => {} }),
}));

type ReconnectHarness = {
  scheduled: Array<{ delayMs: number; fn: () => void }>;
  canceled: number;
};

const reconnectHarness: ReconnectHarness = vi.hoisted(() => ({
  scheduled: [] as Array<{ delayMs: number; fn: () => void }>,
  canceled: 0,
}));

vi.mock("../src/adapters/reconnectTimer.js", () => ({
  scheduleReconnectTimer: (delayMs: number, fn: () => void) => {
    reconnectHarness.scheduled.push({ delayMs, fn });
    return {} as unknown as NodeJS.Timeout;
  },
  cancelReconnectTimer: () => {
    reconnectHarness.canceled += 1;
  },
}));

vi.mock("../src/adapters/vscodeConfig.js", () => ({
  getBackendUrl: () => "http://127.0.0.1:8787",
  autoConnectEnabled: () => true,
}));

const authHarness = vi.hoisted(() => ({
  getGitHubSessionImpl: () =>
    Promise.resolve({ githubAccountId: "acct", accessToken: "gh-token" }) as Promise<{
      githubAccountId: string;
      accessToken: string;
    }>,
}));

vi.mock("../src/adapters/vscodeAuth.js", () => ({
  onDidChangeGitHubSessions: () => ({ dispose: () => {} }),
  getGitHubSession: () => authHarness.getGitHubSessionImpl(),
}));

vi.mock("../src/adapters/sessionExchange.js", () => ({
  exchangeSession: () =>
    Promise.resolve({
      ok: true as const,
      session: {
        token: "backend-token",
        expiresAtMs: Date.now() + 60_000,
        user: {
          githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
          login: "alice",
          avatarUrl: "https://example.test/alice.png",
          roles: [],
        } satisfies AuthUser,
      },
    }),
}));

import { ChatClient } from "../src/net/chatClient.js";

function createOutput(): {
  output: import("vscode").LogOutputChannel;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    output: { info, warn, error } as unknown as import("vscode").LogOutputChannel,
    info,
    warn,
    error,
  };
}

function createGlobalState(): import("vscode").Memento {
  const mem = new Map<string, unknown>();
  return {
    get: <T>(key: string) => mem.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      if (typeof value === "undefined") mem.delete(key);
      else mem.set(key, value);
      return Promise.resolve();
    },
  } as unknown as import("vscode").Memento;
}

function createBusHarness(): {
  bus: ExtensionBus;
  events: Array<{
    type: keyof ExtensionBusEvents;
    payload: ExtensionBusEvents[keyof ExtensionBusEvents];
  }>;
} {
  const events: Array<{
    type: keyof ExtensionBusEvents;
    payload: ExtensionBusEvents[keyof ExtensionBusEvents];
  }> = [];

  const bus = {
    emit: <K extends keyof ExtensionBusEvents>(type: K, payload: ExtensionBusEvents[K]) => {
      events.push({ type, payload });
    },
  } as unknown as ExtensionBus;

  return { bus, events };
}

describe("ChatClient", () => {
  beforeEach(() => {
    wsHarness.openImpl = undefined;
  });

  it("warns when sending without an open socket", () => {
    const { output, warn } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    client.sendMessage({ text: "hi" });

    expect(warn).toHaveBeenCalledWith("WebSocket not open.");
  });

  it("opens a websocket, sends hello, and parses inbound events", async () => {
    wsHarness.sent.length = 0;
    wsHarness.opened = 0;
    wsHarness.lastOptions = undefined;
    wsHarness.ws = undefined;
    reconnectHarness.scheduled.length = 0;
    reconnectHarness.canceled = 0;

    const { output, warn } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    const received: ServerEvent[] = [];
    client.onEvent((event) => received.push(event));

    await client.connectInteractive();

    expect(wsHarness.opened).toBe(1);
    expect(wsHarness.lastOptions?.wsUrl).toBe("ws://127.0.0.1:8787/ws");
    expect(wsHarness.sent.some((s) => s.includes('"type":"client/hello"'))).toBe(true);

    client.sendMessage({ text: "hello" });
    expect(wsHarness.sent.some((s) => s.includes('"type":"client/message.send"'))).toBe(true);

    const ws = wsHarness.ws;
    const opts = wsHarness.lastOptions;
    expect(ws).toBeDefined();
    expect(opts).toBeDefined();
    if (!ws || !opts) throw new Error("missing ws harness");

    (opts.onMessage as unknown as (ws: unknown, text: string) => void)(ws, "{");
    expect(warn).toHaveBeenCalledWith("Invalid JSON from server.");

    const welcome: ServerEvent = {
      version: PROTOCOL_VERSION,
      type: "server/welcome",
      user: {
        githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
        login: "alice",
        avatarUrl: "https://example.test/alice.png",
        roles: [],
      },
      serverTime: new Date().toISOString(),
      history: [],
    };
    (opts.onMessage as unknown as (ws: unknown, text: string) => void)(ws, JSON.stringify(welcome));

    expect(received.some((e) => e.type === "server/welcome")).toBe(true);

    (opts.onClose as unknown as (ws: unknown, code: number, reason: string) => void)(
      ws,
      1006,
      "abnormal",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reconnectHarness.scheduled.length).toBeGreaterThanOrEqual(1);

    reconnectHarness.scheduled[0]?.fn();

    client.dispose();
    expect(reconnectHarness.canceled).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid client payloads and handles ws parse/send errors", async () => {
    wsHarness.sent.length = 0;
    wsHarness.opened = 0;
    wsHarness.lastOptions = undefined;
    wsHarness.ws = undefined;

    const { output, error, warn } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    await client.connectInteractive();

    const ws = wsHarness.ws;
    const opts = wsHarness.lastOptions;
    if (!ws || !opts) throw new Error("missing ws harness");

    (opts.onMessage as unknown as (ws: unknown, text: string) => void)(ws, JSON.stringify({}));
    expect(warn).toHaveBeenCalledWith("Invalid server event schema.");

    (opts.onError as unknown as (ws: unknown, err: unknown) => void)(ws, new Error("boom"));
    expect(error).toHaveBeenCalled();

    (ws as unknown as { send: (data: string) => void }).send = () => {
      throw new Error("send_failed");
    };
    client.sendMessage({ text: "hi" });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("WebSocket send failed:"))).toBe(true);

    client.publishDmIdentity({
      cipherSuite: "nacl.box.v1",
      publicKey: "bad",
    } as unknown as import("@vscode-chat/protocol").DmIdentity);
    expect(warn).toHaveBeenCalledWith("Rejected client payload by schema.");
  });

  it("emits bounded fallback diagnostics when legacy handshake classification is used", async () => {
    wsHarness.sent.length = 0;
    wsHarness.opened = 0;
    wsHarness.lastOptions = undefined;
    wsHarness.ws = undefined;
    reconnectHarness.scheduled.length = 0;
    reconnectHarness.canceled = 0;
    wsHarness.openImpl = (options) => {
      wsHarness.lastOptions = options;
      return Promise.resolve({
        ok: false as const,
        error: {
          type: "handshake_http_error",
          status: 429,
          bodyText: "Room is full",
        },
      });
    };

    const { output, info } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    await expect(client.connectInteractive()).rejects.toBeInstanceOf(Error);

    const prefix = "ws fallback diagnostic: ";
    const entry = info.mock.calls
      .map((args) => String(args[0]))
      .find((line) => line.startsWith(prefix));
    expect(entry).toBeDefined();
    const payload = JSON.parse((entry as string).slice(prefix.length)) as Record<string, string>;
    expect(payload).toEqual({
      boundary: "ws.handshake.fallback",
      phase: "classify_429",
      outcome: "legacy_fallback",
      fallback: "handshake_429_body",
      kind: "room_full",
    });
  });

  it("suppresses reconnect scheduling for user-triggered disconnect closes", async () => {
    wsHarness.sent.length = 0;
    wsHarness.opened = 0;
    wsHarness.lastOptions = undefined;
    wsHarness.ws = undefined;
    reconnectHarness.scheduled.length = 0;
    reconnectHarness.canceled = 0;

    const { output } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    await client.connectInteractive();

    const ws = wsHarness.ws;
    const opts = wsHarness.lastOptions;
    if (!ws || !opts) throw new Error("missing ws harness");

    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));

    (opts.onClose as unknown as (ws: unknown, code: number, reason: string) => void)(
      ws,
      1000,
      "user_disconnect",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getState().status).toBe("disconnected");
    expect(reconnectHarness.scheduled.length).toBe(0);
  });

  it("serializes moderation deny payload reason only when non-empty", async () => {
    wsHarness.sent.length = 0;
    wsHarness.opened = 0;
    wsHarness.lastOptions = undefined;
    wsHarness.ws = undefined;

    const { output } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    await client.connectInteractive();

    const target = "2" as import("@vscode-chat/protocol").GithubUserId;
    client.sendModerationDeny(target, "   ");
    client.sendModerationDeny(target, "abuse");

    const denyEvents = wsHarness.sent
      .map((entry) => JSON.parse(entry) as { type: string; reason?: string })
      .filter((event) => event.type === "client/moderation.user.deny");

    expect(denyEvents).toHaveLength(2);
    expect(denyEvents[0]).not.toHaveProperty("reason");
    expect(denyEvents[1]?.reason).toBe("abuse");
  });

  it("serializes concurrent connect and disconnect requests deterministically", async () => {
    wsHarness.sent.length = 0;
    wsHarness.opened = 0;
    wsHarness.lastOptions = undefined;
    wsHarness.ws = undefined;
    reconnectHarness.scheduled.length = 0;
    reconnectHarness.canceled = 0;

    let releaseSession:
      | ((value: { githubAccountId: string; accessToken: string }) => void)
      | undefined;
    const pendingSession = new Promise<{ githubAccountId: string; accessToken: string }>(
      (resolve) => {
        releaseSession = resolve;
      },
    );
    authHarness.getGitHubSessionImpl = () => pendingSession;

    const { output } = createOutput();
    const { bus } = createBusHarness();
    const client = new ChatClient(output, createGlobalState(), bus);

    const transitions: string[] = [];
    client.onState((state) => {
      transitions.push(`${state.authStatus}:${state.status}`);
    });

    const connectPromise = client.connectInteractive();
    client.disconnect();

    releaseSession?.({ githubAccountId: "acct", accessToken: "gh-token" });
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getState().status).toBe("disconnected");
    expect(transitions).toContain("signedIn:connected");
    expect(transitions.at(-1)).toBe("signedIn:disconnected");

    authHarness.getGitHubSessionImpl = () =>
      Promise.resolve({ githubAccountId: "acct", accessToken: "gh-token" });
  });
});
