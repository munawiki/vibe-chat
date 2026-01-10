import type { ChatMessagePlain, DmId, DmMessagePlain, GithubUserId } from "@vscode-chat/protocol";
import type {
  ExtDmStateMsg,
  ExtModerationActionMsg,
  ExtPresenceMsg,
} from "../../src/contract/webviewProtocol.js";
import type { ActiveOverlay } from "./overlayState.js";

export type OutboxEntry = {
  clientMessageId: string;
  text: string;
  createdAt: string;
  phase: "pending" | "error";
  errorMessage?: string;
};

/**
 * Centralized, mutable Webview runtime state.
 *
 * Why:
 * - The Webview is inherently event-driven (UI events + Extension messages).
 * - A single state object keeps mutations localized and makes feature modules easier to reason about.
 *
 * Invariants:
 * - `activeProfileKey` is the lower-cased `activeProfileLogin` (when a profile is active).
 * - `activeOverlay` describes the single visible modal overlay (if any).
 */
export type WebviewState = {
  activeChannel: "global" | "dm";
  activeDmId: DmId | null;
  globalHistory: ChatMessagePlain[];
  outbox: OutboxEntry[];
  settledClientMessageIds: Set<string>;
  dmThreads: ExtDmStateMsg["threads"];
  dmMessagesById: Map<DmId, DmMessagePlain[]>;
  activeOverlay: ActiveOverlay;
  activeProfileLogin: string;
  activeProfileKey: string;
  activeProfileGithubUserId: GithubUserId | null;
  presenceSnapshot: ExtPresenceMsg["snapshot"] | null;
  isConnected: boolean;
  signedInLoginLowerCase: string | null;
  signedInGithubUserId: GithubUserId | null;
  signedInIsModerator: boolean;
  inputIsComposing: boolean;
  sendPendingAfterComposition: boolean;
  suppressEnterUntilMs: number;
  operatorDeniedGithubUserIds: Set<GithubUserId>;
  roomDeniedGithubUserIds: Set<GithubUserId>;
  moderationAction: ExtModerationActionMsg | null;
};

export function createInitialWebviewState(): WebviewState {
  return {
    activeChannel: "global",
    activeDmId: null,
    globalHistory: [],
    outbox: [],
    settledClientMessageIds: new Set<string>(),
    dmThreads: [],
    dmMessagesById: new Map<DmId, DmMessagePlain[]>(),
    activeOverlay: { kind: "none" },
    activeProfileLogin: "",
    activeProfileKey: "",
    activeProfileGithubUserId: null,
    presenceSnapshot: null,
    isConnected: false,
    signedInLoginLowerCase: null,
    signedInGithubUserId: null,
    signedInIsModerator: false,
    inputIsComposing: false,
    sendPendingAfterComposition: false,
    suppressEnterUntilMs: 0,
    operatorDeniedGithubUserIds: new Set<GithubUserId>(),
    roomDeniedGithubUserIds: new Set<GithubUserId>(),
    moderationAction: null,
  };
}
