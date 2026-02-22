import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { GithubUserId } from "@vscode-chat/protocol";
import {
  DmTrustedKeyStore,
  trustedPeerKeysStorageKeyV2,
} from "../src/ui/chatView/directMessagesTrustStore.js";

type MemoryMemento = vscode.Memento & {
  setFailKeys: (keys: string[]) => void;
};

function createMemoryMemento(): MemoryMemento {
  const data = new Map<string, unknown>();
  const failKeys = new Set<string>();

  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      if (failKeys.has(key)) {
        return Promise.reject(new Error(`forced failure for ${key}`));
      }
      if (typeof value === "undefined") data.delete(key);
      else data.set(key, value);
      return Promise.resolve();
    },
    setFailKeys: (keys: string[]) => {
      failKeys.clear();
      for (const key of keys) failKeys.add(key);
    },
  } as MemoryMemento;
}

function asGithubUserId(raw: string): GithubUserId {
  return raw as GithubUserId;
}

function createOutputHarness(): {
  output: vscode.LogOutputChannel;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  return {
    output: { info, warn } as unknown as vscode.LogOutputChannel,
    info,
    warn,
  };
}

describe("DmTrustedKeyStore", () => {
  it("migrates v1 trusted keys to scoped v2 and clears legacy state after persist", async () => {
    const globalState = createMemoryMemento();
    const { output, info } = createOutputHarness();
    const store = new DmTrustedKeyStore(globalState, output);

    await globalState.update("vscodeChat.dm.trustedPeerKeys.v1", { "2": ["k1"] });

    await store.ensureScope(asGithubUserId("1"));

    expect(globalState.get("vscodeChat.dm.trustedPeerKeys.v1")).toBeUndefined();
    expect(globalState.get(trustedPeerKeysStorageKeyV2(asGithubUserId("1")))).toEqual({
      "2": ["k1"],
    });
    expect(info).toHaveBeenCalledWith(
      'dm trusted keys migration: {"boundary":"dm.trust.migration","phase":"persist_v2","outcome":"ok"}',
    );
    expect(info).toHaveBeenCalledWith(
      'dm trusted keys migration: {"boundary":"dm.trust.migration","phase":"cleanup_v1","outcome":"ok"}',
    );
  });

  it("keeps v1 state when v2 persist fails and allows retry on next ensureScope", async () => {
    const globalState = createMemoryMemento();
    const { output, warn } = createOutputHarness();
    const store = new DmTrustedKeyStore(globalState, output);
    const scope = asGithubUserId("1");
    const v2Key = trustedPeerKeysStorageKeyV2(scope);

    await globalState.update("vscodeChat.dm.trustedPeerKeys.v1", { "2": ["k1"] });
    globalState.setFailKeys([v2Key]);

    await store.ensureScope(scope);

    expect(globalState.get("vscodeChat.dm.trustedPeerKeys.v1")).toEqual({ "2": ["k1"] });
    expect(globalState.get(v2Key)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '{"boundary":"dm.trust.migration","phase":"persist_v2","outcome":"failed","errorClass":"persist_v2_failed"}',
      ),
    );

    globalState.setFailKeys([]);
    store.reset();
    await store.ensureScope(scope);

    expect(globalState.get("vscodeChat.dm.trustedPeerKeys.v1")).toBeUndefined();
    expect(globalState.get(v2Key)).toEqual({ "2": ["k1"] });
  });

  it("keeps trusted-key scope isolated across signed-in accounts", async () => {
    const globalState = createMemoryMemento();
    const { output } = createOutputHarness();
    const store = new DmTrustedKeyStore(globalState, output);

    const user1 = asGithubUserId("1");
    const user2 = asGithubUserId("3");
    const peer = asGithubUserId("2");

    await globalState.update(trustedPeerKeysStorageKeyV2(user1), { [peer]: ["k1"] });

    await store.ensureScope(user1);
    expect(await store.observePeerKey(peer, "k1")).toEqual({ trusted: true });

    await store.ensureScope(user2);
    expect(await store.observePeerKey(peer, "k2")).toEqual({ trusted: true });
    expect(await store.observePeerKey(peer, "k1")).toEqual({ trusted: false });
  });

  it("keeps scoped v2 data when legacy cleanup fails and emits cleanup diagnostics", async () => {
    const globalState = createMemoryMemento();
    const { output, warn } = createOutputHarness();
    const store = new DmTrustedKeyStore(globalState, output);

    const scope = asGithubUserId("1");
    const v2Key = trustedPeerKeysStorageKeyV2(scope);

    await globalState.update("vscodeChat.dm.trustedPeerKeys.v1", { "2": ["k1"] });
    globalState.setFailKeys(["vscodeChat.dm.trustedPeerKeys.v1"]);

    await store.ensureScope(scope);

    expect(globalState.get(v2Key)).toEqual({ "2": ["k1"] });
    expect(globalState.get("vscodeChat.dm.trustedPeerKeys.v1")).toEqual({ "2": ["k1"] });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '{"boundary":"dm.trust.migration","phase":"cleanup_v1","outcome":"failed","errorClass":"cleanup_v1_failed"}',
      ),
    );
  });
});
