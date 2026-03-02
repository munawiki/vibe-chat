import type * as vscode from "vscode";
import type { ServerEvent } from "@vscode-chat/protocol";
import type { ExtOutbound } from "../../contract/protocol/index.js";
import type { ChatClient } from "../../net/chatClient.js";
import type { GitHubProfileService } from "../../net/githubProfile/service.js";
import type { ChatViewDirectMessages } from "../chatView/directMessages.js";
import type { ChatViewModeration } from "../chatView/moderation.js";
import type { ChatViewPresence } from "../chatView/presence.js";

export interface ServerEventPipelineDeps {
  readonly output: vscode.LogOutputChannel;
  readonly routeServerEvent: (event: ServerEvent) => Promise<void>;
}

export interface StateSnapshotSyncDeps {
  readonly client: ChatClient;
  readonly directMessages: Pick<ChatViewDirectMessages, "getStateMessage">;
  readonly presence: Pick<ChatViewPresence, "getSnapshotMessage">;
  readonly moderation: Pick<ChatViewModeration, "getSnapshotMessage">;
  readonly postMessage: (message: ExtOutbound) => void;
  readonly getBackendUrl: () => string | undefined;
}

export interface ProviderContext {
  readonly client: ChatClient;
  readonly output: vscode.LogOutputChannel;
  readonly directMessages: ChatViewDirectMessages;
  readonly moderation: ChatViewModeration;
  readonly presence: ChatViewPresence;
  readonly githubProfiles: GitHubProfileService;
  readonly onUiReady: () => Promise<void>;
  readonly onNewMessage: () => void;
  readonly postMessage: (message: ExtOutbound) => void;
  readonly postError: (message: string) => void;
}
