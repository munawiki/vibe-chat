import * as vscode from "vscode";
import type {
  ClientEvent,
  DmId,
  DmIdentity,
  GithubUserId,
  ServerEvent,
} from "@vscode-chat/protocol";
import type { ExtensionTelemetry } from "../telemetry.js";
import { onDidChangeGitHubSessions } from "../adapters/vscodeAuth.js";
import { getBackendUrl } from "../adapters/vscodeConfig.js";
import {
  initialChatClientCoreState,
  reduceChatClientCore,
  type ChatClientCoreEvent,
  type ChatClientCoreState,
  type ChatClientState,
} from "../core/chatClientCore.js";
import type { ExtensionBus } from "../bus/extensionBus.js";
import { executeChatClientCommand } from "./chatClient/commandExecutor.js";
import { AuthOrchestrator } from "./chatClient/authOrchestrator.js";
import { ClientEventBus } from "./chatClient/clientEventBus.js";
import { DmBridge } from "./chatClient/dmBridge.js";
import {
  emitChatClientBusEvents,
  readInitialAuthPreferences,
  syncChatClientPersistentState,
} from "./chatClient/statePersistence.js";
import { ChatClientWsLifecycle } from "./chatClient/wsLifecycle.js";
import { WsConnectionManager } from "./chatClient/wsConnectionManager.js";
import {
  buildMessageSendPayload,
  buildModerationAllowPayload,
  buildModerationDenyPayload,
} from "./chatClient/payloads.js";

export type { AuthStatus, ChatClientState } from "../core/chatClientCore.js";

export class ChatClient implements vscode.Disposable {
  private core: ChatClientCoreState;
  private state: ChatClientState;
  private readonly disposables: vscode.Disposable[] = [];
  private runChain: Promise<void> = Promise.resolve();

  private readonly eventBus: ClientEventBus;
  private readonly wsConnectionManager: WsConnectionManager;
  private readonly authOrchestrator: AuthOrchestrator;
  private readonly dmBridge: DmBridge;

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly globalState: vscode.Memento,
    private readonly bus: ExtensionBus,
    private readonly telemetry?: ExtensionTelemetry,
  ) {
    this.core = initialChatClientCoreState(readInitialAuthPreferences(this.globalState));
    this.state = this.core.publicState;

    this.eventBus = new ClientEventBus({
      initialState: this.state,
      output: this.output,
    });

    const wsLifecycle = new ChatClientWsLifecycle(
      this.output,
      (event) => this.eventBus.emitEvent(event),
      (event) => this.run(event),
      () => this.getState(),
    );
    this.wsConnectionManager = new WsConnectionManager(wsLifecycle);
    this.dmBridge = new DmBridge({ output: this.output, ws: this.wsConnectionManager });
    this.authOrchestrator = new AuthOrchestrator({
      output: this.output,
      run: (event) => this.run(event),
      getState: () => this.getState(),
      getBackendUrl,
      onDidChangeGitHubSessions,
    });
  }

  dispose(): void {
    this.wsConnectionManager.dispose();
    this.eventBus.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  onState(listener: (state: ChatClientState) => void): vscode.Disposable {
    return this.eventBus.onState(listener);
  }

  onEvent(listener: (event: ServerEvent) => void): vscode.Disposable {
    return this.eventBus.onEvent(listener);
  }

  getState(): ChatClientState {
    return this.state;
  }

  start(): void {
    this.authOrchestrator.start((disposable) => this.disposables.push(disposable));
  }

  async refreshAuthState(): Promise<void> {
    await this.authOrchestrator.refreshAuthState();
  }

  async signIn(): Promise<void> {
    await this.authOrchestrator.signIn();
  }

  async signOut(): Promise<void> {
    await this.authOrchestrator.signOut();
  }

  async connect(): Promise<void> {
    await this.connectInteractive();
  }

  async connectInteractive(): Promise<void> {
    await this.authOrchestrator.connectInteractive();
  }

  async connectIfSignedIn(): Promise<boolean> {
    return this.authOrchestrator.connectIfSignedIn();
  }

  async signInAndConnect(): Promise<void> {
    await this.authOrchestrator.signInAndConnect();
  }

  disconnect(): void {
    this.authOrchestrator.disconnect();
  }

  sendMessage(options: { text: string; clientMessageId?: string }): void {
    this.sendEvent(buildMessageSendPayload(options));
  }

  sendModerationDeny(targetGithubUserId: GithubUserId, reason?: string): void {
    this.sendEvent(buildModerationDenyPayload(targetGithubUserId, reason));
  }

  sendModerationAllow(targetGithubUserId: GithubUserId): void {
    this.sendEvent(buildModerationAllowPayload(targetGithubUserId));
  }

  publishDmIdentity(identity: DmIdentity): void {
    this.dmBridge.publishIdentity(identity);
  }

  openDm(targetGithubUserId: GithubUserId): void {
    this.dmBridge.openDm(targetGithubUserId);
  }

  sendDmMessage(options: {
    dmId: DmId;
    recipientGithubUserId: GithubUserId;
    senderIdentity: DmIdentity;
    recipientIdentity: DmIdentity;
    nonce: string;
    ciphertext: string;
  }): void {
    this.dmBridge.sendDmMessage(options);
  }

  private sendEvent(payload: ClientEvent): void {
    const send = this.wsConnectionManager.sendClientEvent(payload);
    if (send.ok) return;

    if (send.reason === "not_open") {
      this.output.warn("WebSocket not open.");
      return;
    }

    this.output.warn(`WebSocket send failed: ${String(send.error)}`);
  }

  private setState(next: ChatClientState): void {
    this.state = next;
    this.eventBus.emitState(next);
  }

  private run(event: ChatClientCoreEvent): Promise<void> {
    const job = async (): Promise<void> => {
      await this.process(event);
    };

    const next = this.runChain.then(job, job);
    this.runChain = next;
    return next;
  }

  private async process(event: ChatClientCoreEvent): Promise<void> {
    const prev = this.core;
    const { state: next, commands } = reduceChatClientCore(this.core, event);
    this.core = next;
    this.setState(this.core.publicState);

    await syncChatClientPersistentState({
      prev,
      next,
      globalState: this.globalState,
      output: this.output,
    });

    emitChatClientBusEvents({ prev, next, bus: this.bus });

    for (const cmd of commands) {
      const followUp = await executeChatClientCommand({
        cmd,
        wsConnectionManager: this.wsConnectionManager,
        telemetry: this.telemetry,
      });
      if (followUp) await this.process(followUp);
    }
  }
}
