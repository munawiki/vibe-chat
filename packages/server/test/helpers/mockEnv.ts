import type worker from "../../src/index.js";

type EnvStub = Parameters<(typeof worker)["fetch"]>[1];

export function createMockEnv(overrides?: Partial<EnvStub>): EnvStub {
  const chatRoomStub = {
    fetch: () => Promise.resolve(new Response("proxied", { status: 200 })),
  };

  return {
    CHAT_ROOM: {
      idFromName: (name: string) => name,
      get: () => chatRoomStub,
    },
    DM_ROOM: {
      idFromName: (name: string) => name,
      get: () => chatRoomStub,
    },
    SESSION_SECRET: "x".repeat(32),
    ...overrides,
  } as unknown as EnvStub;
}
