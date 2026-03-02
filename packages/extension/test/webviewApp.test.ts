// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@vscode-chat/protocol";
import type { ExtOutbound, UiInbound } from "../src/contract/protocol/index.js";
import type { VscodeWebviewApi } from "../webview-src/app/types.js";

type AcquireVsCodeApi = <T>() => VscodeWebviewApi<T>;
type GlobalWithAcquireVsCodeApi = typeof globalThis & { acquireVsCodeApi: AcquireVsCodeApi };

function setupDom(): void {
  document.body.innerHTML = `
    <button id="btnChannelGlobal"></button>
    <button id="btnChannelDm"></button>
    <div id="dmPanel">
      <div id="dmWarning" hidden>
        <span id="dmWarningText"></span>
        <button id="btnDmTrust"></button>
      </div>
      <div id="dmThreads"></div>
      <div id="dmEmpty"></div>
    </div>

    <button id="btnConnStatus"></button>
    <span id="connDot"></span>
    <span id="connText"></span>

    <button id="btnIdentity"></button>
    <img id="identityAvatar" />
    <span id="identityLogin"></span>

    <div id="presenceOverlay" hidden>
      <div id="presenceCard">
        <button id="presenceClose"></button>
        <div id="presenceTitle"></div>
        <div id="presencePanel"></div>
      </div>
    </div>

    <button id="btnSignIn"></button>
    <button id="btnReconnect"></button>

    <div id="messages"></div>
    <textarea id="input"></textarea>
    <button id="btnSend"></button>

    <div id="error"></div>

    <div id="profileOverlay" hidden>
      <div id="profileCard">
        <button id="profileClose"></button>
        <img id="profileAvatar" />
        <div id="profileName"></div>
        <div id="profileLogin"></div>
        <div id="profileBody"></div>
        <div id="profileError" hidden></div>
        <div id="profileModStatus" hidden></div>
        <div id="profileActions" hidden>
          <button id="profileBan"></button>
          <button id="profileUnban"></button>
        </div>
        <button id="profileMessage" hidden></button>
        <button id="profileSignOut" hidden></button>
        <button id="profileOpenOnGitHub"></button>
      </div>
    </div>
  `;
}

function dispatchExt(msg: ExtOutbound): void {
  const event = new MessageEvent("message", { data: msg, origin: globalThis.location.origin });
  globalThis.dispatchEvent(event);
}

function createUser(options: {
  githubUserId: string;
  login: string;
  roles?: AuthUser["roles"];
}): AuthUser {
  return {
    githubUserId: options.githubUserId as import("@vscode-chat/protocol").GithubUserId,
    login: options.login,
    avatarUrl: `https://example.test/${options.login}.png`,
    roles: options.roles ?? [],
  };
}

describe("webviewApp", () => {
  it("wires UI, processes ext messages, and posts inbound commands", async () => {
    setupDom();

    const posted: UiInbound[] = [];
    const api: VscodeWebviewApi<UiInbound> = {
      postMessage: (message) => posted.push(message),
      getState: () => ({}),
      setState: () => {},
    };
    (globalThis as unknown as GlobalWithAcquireVsCodeApi).acquireVsCodeApi = () =>
      api as unknown as VscodeWebviewApi<UiInbound>;

    await import("../webview-src/app/webviewApp.js");

    expect(posted).toEqual([{ type: "ui/ready" }]);

    const alice = createUser({ githubUserId: "1", login: "alice", roles: ["moderator"] });

    dispatchExt({
      type: "ext/state",
      state: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "https://example.test",
        user: alice,
        actions: {
          signIn: { visible: false, enabled: false, label: "Sign in" },
          connect: { visible: true, enabled: true, label: "Reconnect" },
        },
      },
    });

    expect(document.getElementById("connText")?.textContent).toBe("Connected");
    expect(document.getElementById("identityLogin")?.textContent).toBe("alice");

    (document.getElementById("btnReconnect") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/reconnect")).toBe(true);

    const input = document.getElementById("input") as HTMLTextAreaElement;
    const send = document.getElementById("btnSend") as HTMLButtonElement;

    input.value = "hello";
    send.click();

    const uiSend = posted.find(
      (m): m is Extract<UiInbound, { type: "ui/send" }> => m.type === "ui/send",
    );
    expect(uiSend?.text).toBe("hello");
    expect(typeof uiSend?.clientMessageId).toBe("string");
    expect(input.value).toBe("");

    const messageId = "11111111-1111-1111-1111-111111111111";
    const createdAt = new Date().toISOString();

    dispatchExt({
      type: "ext/message",
      message: { id: messageId, user: alice, text: "hello", createdAt },
      clientMessageId: uiSend?.clientMessageId,
    });

    input.value = "oops";
    send.click();
    const uiSend2 = posted
      .filter((m): m is Extract<UiInbound, { type: "ui/send" }> => m.type === "ui/send")
      .at(-1);
    expect(uiSend2?.text).toBe("oops");

    dispatchExt({
      type: "ext/message.send.error",
      clientMessageId: uiSend2?.clientMessageId ?? "22222222-2222-2222-2222-222222222222",
      code: "rate_limited",
      message: "Too many messages",
    });

    dispatchExt({
      type: "ext/history",
      history: [{ id: "h1", user: alice, text: "seed", createdAt }],
    });

    dispatchExt({ type: "ext/error", message: "Boom" });
    expect(document.getElementById("error")?.classList.contains("visible")).toBe(true);

    input.value = "pending";
    send.click();

    dispatchExt({
      type: "ext/state",
      state: {
        authStatus: "signedIn",
        status: "disconnected",
        backendUrl: "https://example.test",
        user: alice,
        actions: {
          signIn: { visible: false, enabled: false, label: "Sign in" },
          connect: { visible: true, enabled: true, label: "Reconnect" },
        },
      },
    });

    expect(document.getElementById("connText")?.textContent).toBe("Disconnected");
    const pendingRow = document.querySelector(".outboxRow.failed");
    expect(pendingRow?.textContent).toContain("Not connected.");

    dispatchExt({
      type: "ext/state",
      state: {
        authStatus: "signedOut",
        status: "disconnected",
        actions: {
          signIn: { visible: true, enabled: true, label: "Sign in" },
          connect: { visible: false, enabled: false, label: "Connect" },
        },
      },
    });
    (document.getElementById("btnSignIn") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/signIn")).toBe(true);

    dispatchExt({
      type: "ext/dm.state",
      threads: [
        {
          dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
          peer: createUser({ githubUserId: "2", login: "bob" }),
          isBlocked: true,
          canTrustKey: true,
          warning: "Untrusted key",
        },
      ],
    });

    // Cover "dm channel without an active thread" first.
    dispatchExt({ type: "ext/dm.state", threads: [] });
    (document.getElementById("btnChannelDm") as HTMLButtonElement).click();

    dispatchExt({
      type: "ext/dm.state",
      threads: [
        {
          dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
          peer: createUser({ githubUserId: "2", login: "bob" }),
          isBlocked: false,
          canTrustKey: false,
        },
      ],
    });

    dispatchExt({
      type: "ext/dm.history",
      dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
      history: [
        {
          id: "dm1",
          dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
          user: createUser({ githubUserId: "2", login: "bob" }),
          text: "dm seed",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    dispatchExt({
      type: "ext/dm.message",
      message: {
        id: "dm2",
        dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
        user: createUser({ githubUserId: "2", login: "bob" }),
        text: "dm new",
        createdAt: new Date().toISOString(),
      },
    });

    dispatchExt({
      type: "ext/dm.state",
      threads: [],
    });

    dispatchExt({
      type: "ext/moderation.snapshot",
      operatorDeniedGithubUserIds: [],
      roomDeniedGithubUserIds: [],
    });
    dispatchExt({
      type: "ext/moderation.user.denied",
      actorGithubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    dispatchExt({
      type: "ext/moderation.user.allowed",
      actorGithubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    dispatchExt({
      type: "ext/moderation.action",
      action: "deny",
      phase: "pending",
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });

    // Ensure error is cleared by subsequent state updates.
    expect(document.getElementById("error")?.classList.contains("visible")).toBe(false);

    // Restore connected state for the rest of the flow.
    dispatchExt({
      type: "ext/state",
      state: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "https://example.test",
        user: alice,
        actions: {
          signIn: { visible: false, enabled: false, label: "Sign in" },
          connect: { visible: true, enabled: true, label: "Reconnect" },
        },
      },
    });

    dispatchExt({
      type: "ext/dm.state",
      threads: [
        {
          dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
          peer: createUser({ githubUserId: "2", login: "bob" }),
          isBlocked: true,
          canTrustKey: true,
          warning: "Untrusted key",
        },
      ],
    });

    (document.getElementById("btnChannelDm") as HTMLButtonElement).click();

    const dmSelect = posted.find(
      (m): m is Extract<UiInbound, { type: "ui/dm.thread.select" }> =>
        m.type === "ui/dm.thread.select",
    );
    expect(dmSelect?.dmId).toBe("dm:v1:1:2");

    const dmTrust = document.getElementById("btnDmTrust") as HTMLButtonElement;
    dmTrust.click();
    expect(posted.some((m) => m.type === "ui/dm.peerKey.trust" && m.dmId === "dm:v1:1:2")).toBe(
      true,
    );

    dispatchExt({
      type: "ext/dm.state",
      threads: [
        {
          dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
          peer: createUser({ githubUserId: "2", login: "bob" }),
          isBlocked: false,
          canTrustKey: false,
        },
      ],
    });

    input.value = "dm hello";
    send.click();
    expect(
      posted.some(
        (m) => m.type === "ui/dm.send" && m.dmId === "dm:v1:1:2" && m.text === "dm hello",
      ),
    ).toBe(true);

    dispatchExt({
      type: "ext/presence",
      snapshot: [{ user: alice, connections: 1 }],
    });

    (document.getElementById("btnConnStatus") as HTMLButtonElement).click();
    expect((document.getElementById("presenceOverlay") as HTMLElement).hidden).toBe(false);

    (document.querySelector(".presenceLogin") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/profile.open" && m.login === "alice")).toBe(true);

    dispatchExt({
      type: "ext/profile.result",
      login: "alice",
      profile: {
        login: "alice",
        githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
        avatarUrl: "https://example.test/alice.png",
        htmlUrl: "https://github.com/alice",
        name: "Alice",
      },
    });
    expect(document.getElementById("profileName")?.textContent).toBe("Alice");

    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(true);

    (document.getElementById("btnIdentity") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/profile.open" && m.login === "alice")).toBe(true);

    dispatchExt({ type: "ext/profile.error", login: "bob", message: "ignored" });
    dispatchExt({ type: "ext/profile.error", login: "alice", message: "Oops" });
    expect(document.getElementById("profileError")?.textContent).toContain(
      "Unable to load profile.",
    );

    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(true);
  });
});
