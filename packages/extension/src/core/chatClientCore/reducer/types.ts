import type { ChatClientCoreCommand, ChatClientCoreState } from "../types.js";

export type ReduceResult = { state: ChatClientCoreState; commands: ChatClientCoreCommand[] };
