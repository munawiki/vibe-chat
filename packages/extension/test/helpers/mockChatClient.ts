import { vi } from "vitest";
import type { ServerEvent } from "@vscode-chat/protocol";
import type { ChatClient, ChatClientState } from "../../src/net/chatClient.js";

type Disposable = { dispose: () => void };

export function createMockChatClient(initialState: ChatClientState): {
  client: ChatClient;
  setState: (next: ChatClientState) => void;
  emitEvent: (event: ServerEvent) => void;
  calls: {
    sendMessage: Array<{ text: string; clientMessageId?: string }>;
    sendModerationDeny: Array<string>;
    sendModerationAllow: Array<string>;
    disconnect: number;
    connectIfSignedIn: number;
    signInAndConnect: number;
    signOut: number;
  };
} {
  let state = initialState;
  const stateListeners: Array<(next: ChatClientState) => void> = [];
  const eventListeners: Array<(event: ServerEvent) => void> = [];

  const calls = {
    sendMessage: [] as Array<{ text: string; clientMessageId?: string }>,
    sendModerationDeny: [] as string[],
    sendModerationAllow: [] as string[],
    disconnect: 0,
    connectIfSignedIn: 0,
    signInAndConnect: 0,
    signOut: 0,
  };

  const client: ChatClient = {
    getState: () => state,
    onState: (listener: (next: ChatClientState) => void): Disposable => {
      stateListeners.push(listener);
      listener(state);
      return { dispose: vi.fn() };
    },
    onEvent: (listener: (event: ServerEvent) => void): Disposable => {
      eventListeners.push(listener);
      return { dispose: vi.fn() };
    },
    refreshAuthState: vi.fn(async () => {}),
    connectIfSignedIn: vi.fn(async () => {
      calls.connectIfSignedIn += 1;
      return true;
    }),
    signInAndConnect: vi.fn(async () => {
      calls.signInAndConnect += 1;
    }),
    signOut: vi.fn(async () => {
      calls.signOut += 1;
    }),
    disconnect: vi.fn(() => {
      calls.disconnect += 1;
    }),
    sendMessage: vi.fn((options: { text: string; clientMessageId?: string }) => {
      calls.sendMessage.push(options);
    }),
    sendModerationDeny: vi.fn((targetGithubUserId) => {
      calls.sendModerationDeny.push(String(targetGithubUserId));
    }),
    sendModerationAllow: vi.fn((targetGithubUserId) => {
      calls.sendModerationAllow.push(String(targetGithubUserId));
    }),
    publishDmIdentity: vi.fn(),
    openDm: vi.fn(),
    sendDmMessage: vi.fn(),
    start: vi.fn(),
    dispose: vi.fn(),
    signIn: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    connectInteractive: vi.fn(async () => {}),
  } as unknown as ChatClient;

  return {
    client,
    setState: (next) => {
      state = next;
      for (const listener of stateListeners) listener(next);
    },
    emitEvent: (event) => {
      for (const listener of eventListeners) listener(event);
    },
    calls,
  };
}
