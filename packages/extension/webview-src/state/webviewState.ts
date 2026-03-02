import type { ChatMessagePlain, DmId, DmMessagePlain, GithubUserId } from "@vscode-chat/protocol";
import type {
  ExtDmStateMsg,
  ExtModerationActionMsg,
  ExtPresenceMsg,
} from "../../src/contract/protocol/index.js";
import type { ActiveOverlay } from "./overlayState.js";

export type OutboxEntry = {
  clientMessageId: string;
  text: string;
  createdAt: string;
  phase: "pending" | "error";
  errorMessage?: string;
};

export type ChannelState = {
  activeChannel: "global" | "dm";
  activeDmId: DmId | null;
  dmThreads: ExtDmStateMsg["threads"];
  dmMessagesById: Map<DmId, DmMessagePlain[]>;
};

export type AuthState = {
  isConnected: boolean;
  signedInLoginLowerCase: string | null;
  signedInGithubUserId: GithubUserId | null;
  signedInIsModerator: boolean;
};

export type ModerationViewState = {
  operatorDeniedGithubUserIds: Set<GithubUserId>;
  roomDeniedGithubUserIds: Set<GithubUserId>;
  moderationAction: ExtModerationActionMsg | null;
};

export type ImeState = {
  inputIsComposing: boolean;
  sendPendingAfterComposition: boolean;
  suppressEnterUntilMs: number;
};

export type OverlayViewState = {
  activeOverlay: ActiveOverlay;
  activeProfileLogin: string;
  activeProfileKey: string;
  activeProfileGithubUserId: GithubUserId | null;
};

export type WebviewState = {
  channel: ChannelState;
  auth: AuthState;
  moderation: ModerationViewState;
  ime: ImeState;
  overlay: OverlayViewState;
  globalHistory: ChatMessagePlain[];
  outbox: OutboxEntry[];
  settledClientMessageIds: Set<string>;
  presenceSnapshot: ExtPresenceMsg["snapshot"] | null;
};

export function createInitialWebviewState(): WebviewState {
  return {
    channel: {
      activeChannel: "global",
      activeDmId: null,
      dmThreads: [],
      dmMessagesById: new Map<DmId, DmMessagePlain[]>(),
    },
    auth: {
      isConnected: false,
      signedInLoginLowerCase: null,
      signedInGithubUserId: null,
      signedInIsModerator: false,
    },
    moderation: {
      operatorDeniedGithubUserIds: new Set<GithubUserId>(),
      roomDeniedGithubUserIds: new Set<GithubUserId>(),
      moderationAction: null,
    },
    ime: {
      inputIsComposing: false,
      sendPendingAfterComposition: false,
      suppressEnterUntilMs: 0,
    },
    overlay: {
      activeOverlay: { kind: "none" },
      activeProfileLogin: "",
      activeProfileKey: "",
      activeProfileGithubUserId: null,
    },
    globalHistory: [],
    outbox: [],
    settledClientMessageIds: new Set<string>(),
    presenceSnapshot: null,
  };
}
