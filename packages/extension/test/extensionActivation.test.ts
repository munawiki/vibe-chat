import { describe, expect, it, vi } from "vitest";

const vscodeState = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void> | void>(),
  onDidChangeConfiguration: undefined as
    | undefined
    | ((e: { affectsConfiguration: (k: string) => boolean }) => void),
  executeCommand: vi.fn(() => Promise.resolve(undefined)),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
}));

vi.mock("vscode", () => ({
  ExtensionMode: { Development: 1, Production: 2 },
  window: {
    createOutputChannel: () => ({
      dispose: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
    registerWebviewViewProvider: () => ({ dispose: vi.fn() }),
    showInformationMessage: vscodeState.showInformationMessage,
    showErrorMessage: vscodeState.showErrorMessage,
  },
  commands: {
    registerCommand: (id: string, cb: () => Promise<void> | void) => {
      vscodeState.commands.set(id, cb);
      return { dispose: vi.fn() };
    },
    executeCommand: vscodeState.executeCommand,
  },
  workspace: {
    getConfiguration: () => ({ get: () => undefined }),
    onDidChangeConfiguration: (
      cb: (e: { affectsConfiguration: (k: string) => boolean }) => void,
    ) => {
      vscodeState.onDidChangeConfiguration = cb;
      return { dispose: vi.fn() };
    },
  },
}));

const extensionState = vi.hoisted(() => ({
  clientState: { authStatus: "signedOut" } as unknown,
  client: undefined as
    | undefined
    | {
        start: () => void;
        signIn: () => Promise<void>;
        signOut: () => Promise<void>;
        getState: () => unknown;
        dispose: () => void;
      },
  provider: undefined as undefined | { onConfigChanged: () => void; dispose: () => void },
}));

vi.mock("../src/telemetry.js", () => ({
  createExtensionTelemetry: () => ({ send: vi.fn(), dispose: vi.fn() }),
}));

vi.mock("../src/bus/extensionBus.js", () => ({
  createExtensionBus: () => ({}),
}));

vi.mock("../src/net/chatClient.js", () => ({
  ChatClient: class {
    start = vi.fn();
    signIn = vi.fn(() => Promise.resolve(undefined));
    signOut = vi.fn(() => Promise.resolve(undefined));
    dispose = vi.fn();
    getState = () => extensionState.clientState;
    constructor() {
      extensionState.client = this;
    }
  },
}));

vi.mock("../src/ui/chatViewProvider/provider.js", () => ({
  ChatViewProvider: class {
    static viewType = "vscodeChat.chatView";
    onConfigChanged = vi.fn();
    dispose = vi.fn();
    constructor() {
      extensionState.provider = this;
    }
  },
}));

vi.mock("../src/ui/chatStatusBar.js", () => ({
  ChatStatusBar: class {
    dispose = vi.fn();
  },
}));

vi.mock("../src/e2ee/dmCrypto.js", () => ({
  DM_SECRET_STORAGE_KEY_V1: "dm:key:v1",
  dmSecretStorageKeyV2: (githubUserId: string) => `dm:key:v2:${githubUserId}`,
}));

import * as vscode from "vscode";
import { activate } from "../src/extension.js";

function createContext(mode: number) {
  const subscriptions: Array<{ dispose: () => void }> = [];
  return {
    extensionMode: mode as unknown as import("vscode").ExtensionMode,
    subscriptions,
    globalState: {} as unknown as import("vscode").Memento,
    secrets: {
      delete: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as import("vscode").SecretStorage,
  } as unknown as import("vscode").ExtensionContext;
}

describe("activate", () => {
  it("registers commands and wires config changes", async () => {
    const ctx = createContext(vscode.ExtensionMode.Production);
    activate(ctx);

    expect(vscodeState.commands.has("vscodeChat.openChat")).toBe(true);
    expect(vscodeState.commands.has("vscodeChat.signIn")).toBe(true);
    expect(vscodeState.commands.has("vscodeChat.signOut")).toBe(true);
    expect(vscodeState.commands.has("vscodeChat.dev.rotateDmKey")).toBe(false);

    await vscodeState.commands.get("vscodeChat.openChat")?.();
    expect(vscodeState.executeCommand).toHaveBeenCalledWith("workbench.view.extension.vscodeChat");

    await vscodeState.commands.get("vscodeChat.signIn")?.();
    expect(extensionState.client?.signIn).toHaveBeenCalledTimes(1);

    await vscodeState.commands.get("vscodeChat.signOut")?.();
    expect(extensionState.client?.signOut).toHaveBeenCalledTimes(1);

    vscodeState.onDidChangeConfiguration?.({
      affectsConfiguration: (k) => k === "vscodeChat.backendUrl",
    });
    expect(extensionState.provider?.onConfigChanged).toHaveBeenCalledTimes(1);

    vscodeState.onDidChangeConfiguration?.({ affectsConfiguration: () => false });
    expect(extensionState.provider?.onConfigChanged).toHaveBeenCalledTimes(1);
  });

  it("registers dev rotateDmKey in development mode", async () => {
    const ctx = createContext(vscode.ExtensionMode.Development);
    activate(ctx);

    expect(vscodeState.commands.has("vscodeChat.dev.rotateDmKey")).toBe(true);

    extensionState.clientState = {
      authStatus: "signedIn",
      user: { githubUserId: "1" },
    };
    await vscodeState.commands.get("vscodeChat.dev.rotateDmKey")?.();
    expect(
      (ctx.secrets as unknown as { delete: ReturnType<typeof vi.fn> }).delete,
    ).toHaveBeenCalledWith("dm:key:v2:1");
    expect(vscodeState.showInformationMessage).toHaveBeenCalled();

    extensionState.clientState = { authStatus: "signedOut" };
    await vscodeState.commands.get("vscodeChat.dev.rotateDmKey")?.();
    expect(
      (ctx.secrets as unknown as { delete: ReturnType<typeof vi.fn> }).delete,
    ).toHaveBeenCalledWith("dm:key:v1");
  });
});
