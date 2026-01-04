import type { ChatMessagePlain, DmId, DmMessagePlain, GithubUserId } from "@vscode-chat/protocol";
import type {
  ExtDmStateMsg,
  ExtModerationActionMsg,
  ExtPresenceMsg,
} from "../../src/contract/webviewProtocol.js";

/**
 * Centralized, mutable Webview runtime state.
 *
 * Why:
 * - The Webview is inherently event-driven (UI events + Extension messages).
 * - A single state object keeps mutations localized and makes feature modules easier to reason about.
 *
 * Invariants:
 * - `activeProfileKey` is the lower-cased `activeProfileLogin` (when a profile is active).
 * - Presence/profile visibility flags reflect overlay DOM visibility.
 */
export type WebviewState = {
  activeChannel: "global" | "dm";
  activeDmId: DmId | null;
  globalHistory: ChatMessagePlain[];
  dmThreads: ExtDmStateMsg["threads"];
  dmMessagesById: Map<DmId, DmMessagePlain[]>;
  activeProfileLogin: string;
  activeProfileKey: string;
  activeProfileGithubUserId: GithubUserId | null;
  profileVisible: boolean;
  presenceVisible: boolean;
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
    dmThreads: [],
    dmMessagesById: new Map<DmId, DmMessagePlain[]>(),
    activeProfileLogin: "",
    activeProfileKey: "",
    activeProfileGithubUserId: null,
    profileVisible: false,
    presenceVisible: false,
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
