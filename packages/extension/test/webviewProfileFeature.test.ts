// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { UiInbound } from "../src/contract/webviewProtocol.js";
import type { VscodeWebviewApi, WebviewContext } from "../webview-src/app/types.js";
import { getElements } from "../webview-src/dom/elements.js";
import { createInitialWebviewState } from "../webview-src/state/webviewState.js";
import {
  bindProfileUiEvents,
  handleExtModerationAction,
  handleExtModerationSnapshot,
  handleExtModerationUserAllowed,
  handleExtModerationUserDenied,
  handleExtProfileError,
  handleExtProfileResult,
  openProfile,
} from "../webview-src/features/profile.js";

function setupDom(): void {
  document.body.innerHTML = `
    <button id="btnChannelDm"></button>

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

describe("webview profile feature", () => {
  it("opens profile, renders actions, and posts UI commands", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };

    const state = createInitialWebviewState();
    state.isConnected = true;
    state.signedInGithubUserId = "1" as import("@vscode-chat/protocol").GithubUserId;
    state.signedInIsModerator = true;

    const els = getElements();
    let dmTabClicked = false;
    els.channelDm?.addEventListener("click", () => {
      dmTabClicked = true;
    });

    const ctx: WebviewContext = { vscode, els, state, queueTask: queueMicrotask };
    bindProfileUiEvents(ctx);

    openProfile(ctx, "bob", "https://example.test/bob.png");
    expect(posted.some((m) => m.type === "ui/profile.open" && m.login === "bob")).toBe(true);
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(false);

    handleExtProfileResult(ctx, {
      type: "ext/profile.result",
      login: "bob",
      profile: {
        login: "bob",
        githubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
        avatarUrl: "https://example.test/bob.png",
        htmlUrl: "https://github.com/bob",
        name: "Bob",
        bio: "hi",
        company: "ACME",
        location: "Earth",
        blog: "https://blog.example.test",
      },
    });

    expect((document.getElementById("profileActions") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("profileBan") as HTMLButtonElement).hidden).toBe(false);
    expect((document.getElementById("profileMessage") as HTMLButtonElement).hidden).toBe(false);

    (document.getElementById("profileOpenOnGitHub") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/profile.openOnGitHub" && m.login === "bob")).toBe(
      true,
    );

    (document.getElementById("profileBan") as HTMLButtonElement).click();
    expect(
      posted.some((m) => m.type === "ui/moderation.user.deny" && m.targetGithubUserId === "2"),
    ).toBe(true);

    (document.getElementById("profileMessage") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/dm.open" && m.peer.login === "bob")).toBe(true);
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(true);
    expect(dmTabClicked).toBe(true);
  });

  it("updates moderation state and shows profile errors", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };

    const state = createInitialWebviewState();
    state.isConnected = true;
    state.signedInGithubUserId = "1" as import("@vscode-chat/protocol").GithubUserId;
    state.signedInIsModerator = true;

    const ctx: WebviewContext = { vscode, els: getElements(), state, queueTask: queueMicrotask };
    bindProfileUiEvents(ctx);

    openProfile(ctx, "alice", "https://example.test/alice.png");

    handleExtModerationSnapshot(ctx, {
      type: "ext/moderation.snapshot",
      operatorDeniedGithubUserIds: ["3" as import("@vscode-chat/protocol").GithubUserId],
      roomDeniedGithubUserIds: [],
    });

    handleExtProfileResult(ctx, {
      type: "ext/profile.result",
      login: "alice",
      profile: {
        login: "alice",
        githubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
        avatarUrl: "https://example.test/alice.png",
        htmlUrl: "https://github.com/alice",
        name: "Alice",
      },
    });

    handleExtModerationUserDenied(ctx, {
      type: "ext/moderation.user.denied",
      actorGithubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    expect((document.getElementById("profileUnban") as HTMLButtonElement).hidden).toBe(false);

    handleExtModerationUserAllowed(ctx, {
      type: "ext/moderation.user.allowed",
      actorGithubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    expect((document.getElementById("profileBan") as HTMLButtonElement).hidden).toBe(false);

    handleExtModerationAction(ctx, {
      type: "ext/moderation.action",
      action: "deny",
      phase: "pending",
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    expect((document.getElementById("profileModStatus") as HTMLElement).hidden).toBe(false);

    handleExtProfileError(ctx, {
      type: "ext/profile.error",
      login: "alice",
      message: "Oops",
    });
    expect((document.getElementById("profileError") as HTMLElement).hidden).toBe(false);
    expect(document.getElementById("profileBody")?.textContent).toContain("Oops");
  });

  it("handles stale profile events and moderation status transitions", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };

    const state = createInitialWebviewState();
    state.isConnected = true;
    state.signedInGithubUserId = "1" as import("@vscode-chat/protocol").GithubUserId;
    state.signedInIsModerator = true;

    const ctx: WebviewContext = { vscode, els: getElements(), state, queueTask: queueMicrotask };
    bindProfileUiEvents(ctx);

    openProfile(ctx, "alice", "https://example.test/alice.png");
    handleExtProfileResult(ctx, {
      type: "ext/profile.result",
      login: "bob",
      profile: {
        login: "bob",
        githubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
        avatarUrl: "https://example.test/bob.png",
        htmlUrl: "https://github.com/bob",
        name: "Bob",
      },
    });
    expect(document.getElementById("profileLogin")?.textContent).toBe("alice");

    handleExtProfileResult(ctx, {
      type: "ext/profile.result",
      login: "alice",
      profile: {
        login: "alice",
        githubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
        avatarUrl: "https://example.test/alice.png",
        htmlUrl: "https://github.com/alice",
        name: "Alice",
      },
    });

    handleExtModerationSnapshot(ctx, {
      type: "ext/moderation.snapshot",
      operatorDeniedGithubUserIds: ["2" as import("@vscode-chat/protocol").GithubUserId],
      roomDeniedGithubUserIds: [],
    });
    expect(document.getElementById("profileModStatus")?.textContent).toBe(
      "Blocked by operator policy.",
    );

    handleExtModerationAction(ctx, {
      type: "ext/moderation.action",
      action: "deny",
      phase: "success",
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    expect(document.getElementById("profileModStatus")?.textContent).toBe("Banned.");

    handleExtModerationAction(ctx, {
      type: "ext/moderation.action",
      action: "allow",
      phase: "success",
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    expect(document.getElementById("profileModStatus")?.textContent).toBe("Unbanned.");

    handleExtModerationAction(ctx, {
      type: "ext/moderation.action",
      action: "allow",
      phase: "error",
      targetGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
    });
    expect(document.getElementById("profileModStatus")?.textContent).toBe(
      "Moderation action failed.",
    );

    handleExtProfileError(ctx, {
      type: "ext/profile.error",
      login: "bob",
      message: "ignored",
    });
    expect(document.getElementById("profileError")?.hidden).toBe(true);

    (document.getElementById("profileOverlay") as HTMLDivElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(true);

    expect(posted.some((m) => m.type === "ui/profile.open" && m.login === "alice")).toBe(true);
  });

  it("guards profile actions when required fields are missing and supports sign-out", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };

    const state = createInitialWebviewState();
    state.isConnected = true;
    state.signedInGithubUserId = "1" as import("@vscode-chat/protocol").GithubUserId;
    state.signedInIsModerator = true;

    const ctx: WebviewContext = { vscode, els: getElements(), state, queueTask: queueMicrotask };
    bindProfileUiEvents(ctx);

    openProfile(ctx, "me", "https://example.test/me.png");
    state.activeProfileLogin = "";
    (document.getElementById("profileOpenOnGitHub") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/profile.openOnGitHub")).toBe(false);

    (document.getElementById("profileBan") as HTMLButtonElement).click();
    (document.getElementById("profileUnban") as HTMLButtonElement).click();
    expect(posted.some((m) => m.type === "ui/moderation.user.deny")).toBe(false);
    expect(posted.some((m) => m.type === "ui/moderation.user.allow")).toBe(false);

    handleExtProfileResult(ctx, {
      type: "ext/profile.result",
      login: "me",
      profile: {
        login: "me",
        githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
        avatarUrl: "https://example.test/me.png",
        htmlUrl: "https://github.com/me",
        name: "Me",
      },
    });

    const signOut = document.getElementById("profileSignOut") as HTMLButtonElement;
    expect(signOut.hidden).toBe(false);
    signOut.click();
    expect(posted.some((m) => m.type === "ui/signOut")).toBe(true);
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(true);
  });
});
