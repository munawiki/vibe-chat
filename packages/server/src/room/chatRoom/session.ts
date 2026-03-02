import type { AuthUser, GithubUserId } from "@vscode-chat/protocol";
import { parseServerConfig, type ChatRoomGuardrails } from "../../config.js";
import { tryGetSocketUser, type SocketAttachment } from "../../socketAttachment.js";
import type { ChatRoomDeps } from "./types.js";

export type ParsedChatRoomConfig = {
  guardrails: ChatRoomGuardrails;
  moderatorGithubUserIds: ReadonlySet<GithubUserId>;
  operatorDeniedGithubUserIds: ReadonlySet<GithubUserId>;
};

export class ChatRoomSession {
  constructor(
    private readonly deps: Pick<ChatRoomDeps, "log" | "sendError">,
    private readonly env: {
      SESSION_SECRET: string;
      DENY_GITHUB_USER_IDS?: string;
      MODERATOR_GITHUB_USER_IDS?: string;
    } & Record<string, unknown>,
  ) {}

  parseConfigOrThrow(scope: "chat_room" | "worker"): ParsedChatRoomConfig {
    const configParsed = parseServerConfig(this.env);
    if (!configParsed.ok) {
      this.deps.log({ type: "invalid_config", issues: configParsed.error.issues, scope });
      throw new Error("invalid_config");
    }

    return {
      guardrails: configParsed.config.chatRoom,
      moderatorGithubUserIds: configParsed.config.moderatorGithubUserIds,
      operatorDeniedGithubUserIds: configParsed.config.operatorDeniedGithubUserIds,
    };
  }

  toSocketUser(
    user: Omit<AuthUser, "roles">,
    moderatorGithubUserIds: ReadonlySet<GithubUserId>,
  ): AuthUser {
    const roles: AuthUser["roles"] = moderatorGithubUserIds.has(user.githubUserId)
      ? ["moderator"]
      : [];
    return { ...user, roles };
  }

  attachSocketUser(ws: WebSocket, user: AuthUser): void {
    ws.serializeAttachment({ user } satisfies SocketAttachment);
  }

  getSocketUserOrClose(ws: WebSocket): AuthUser | undefined {
    const user = tryGetSocketUser(ws);
    if (user) return user;

    this.deps.sendError(ws, { code: "server_error", message: "Missing connection identity" });
    ws.close(1011, "server_error");
    return undefined;
  }
}
