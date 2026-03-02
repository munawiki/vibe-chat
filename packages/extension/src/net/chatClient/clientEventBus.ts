import type * as vscode from "vscode";
import type { ServerEvent } from "@vscode-chat/protocol";
import type { ChatClientState } from "../../core/chatClientCore.js";
import type { ClientEventBusDeps } from "./types.js";

export class ClientEventBus {
  private state: ChatClientState;
  private readonly stateListeners = new Set<(state: ChatClientState) => void>();
  private readonly eventListeners = new Set<(event: ServerEvent) => void>();
  private readonly emitInitialOnSubscribe: boolean;
  private readonly output: vscode.LogOutputChannel | undefined;

  constructor(deps: ClientEventBusDeps) {
    this.state = deps.initialState;
    this.emitInitialOnSubscribe = deps.emitInitialOnSubscribe ?? true;
    this.output = deps.output;
  }

  onState(listener: (state: ChatClientState) => void): vscode.Disposable {
    this.stateListeners.add(listener);
    if (this.emitInitialOnSubscribe) listener(this.state);
    return { dispose: () => this.stateListeners.delete(listener) };
  }

  onEvent(listener: (event: ServerEvent) => void): vscode.Disposable {
    this.eventListeners.add(listener);
    return { dispose: () => this.eventListeners.delete(listener) };
  }

  emitState(next: ChatClientState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  emitEvent(event: ServerEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  getState(): ChatClientState {
    return this.state;
  }

  clear(): void {
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.output?.debug?.("chat client event bus disposed");
  }
}
