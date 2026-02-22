// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { UiInbound } from "../src/contract/webviewProtocol.js";
import type { VscodeWebviewApi, WebviewContext } from "../webview-src/app/types.js";
import { getElements } from "../webview-src/dom/elements.js";
import { closeOverlay, openOverlay } from "../webview-src/features/overlay.js";
import { createInitialWebviewState } from "../webview-src/state/webviewState.js";

function setupDom(): void {
  document.body.innerHTML = `
    <button id="btnConnStatus"></button>
    <div id="presenceOverlay" hidden>
      <button id="presenceClose"></button>
    </div>
    <div id="profileOverlay" hidden>
      <button id="profileClose"></button>
      <div id="profileBody"></div>
      <div id="profileError"></div>
      <div id="profileModStatus"></div>
      <div id="profileActions"></div>
      <button id="profileMessage"></button>
    </div>
  `;
}

function createCtx(): WebviewContext {
  const vscode: VscodeWebviewApi<UiInbound> = {
    postMessage: () => {},
    getState: () => ({}),
    setState: () => {},
  };
  return {
    vscode,
    els: getElements(),
    state: createInitialWebviewState(),
    queueTask: queueMicrotask,
  };
}

describe("webview overlay feature", () => {
  it("opens/closes presence and profile overlays while syncing UI state", () => {
    setupDom();
    const ctx = createCtx();

    openOverlay(ctx, "presence");
    expect(ctx.state.activeOverlay.kind).toBe("presence");
    expect((document.getElementById("presenceOverlay") as HTMLElement).hidden).toBe(false);
    expect(document.getElementById("btnConnStatus")?.getAttribute("aria-expanded")).toBe("true");

    openOverlay(ctx, "profile");
    expect(ctx.state.activeOverlay.kind).toBe("profile");
    expect((document.getElementById("presenceOverlay") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("profileOverlay") as HTMLElement).hidden).toBe(false);

    ctx.state.activeProfileLogin = "alice";
    ctx.state.activeProfileKey = "alice";
    ctx.state.activeProfileGithubUserId = "1" as import("@vscode-chat/protocol").GithubUserId;
    const closed = closeOverlay(ctx);
    expect(closed).toBe(true);
    expect(ctx.state.activeOverlay.kind).toBe("none");
    expect(ctx.state.activeProfileLogin).toBe("");
    expect(ctx.state.activeProfileGithubUserId).toBeNull();
  });

  it("returns false when closing while no overlay is active and tolerates missing elements", () => {
    setupDom();
    const ctx = createCtx();

    expect(closeOverlay(ctx)).toBe(false);

    ctx.els.profileOverlay = null;
    ctx.els.profileClose = null;
    ctx.els.profileBody = null;
    ctx.els.profileError = null;
    ctx.els.profileModStatus = null;
    ctx.els.profileActions = null;
    ctx.els.profileMessage = null;
    ctx.els.presenceOverlay = null;
    ctx.els.presenceClose = null;
    ctx.els.connButton = null;

    openOverlay(ctx, "profile");
    expect(ctx.state.activeOverlay.kind).toBe("profile");
    closeOverlay(ctx);
    expect(ctx.state.activeOverlay.kind).toBe("none");
  });

  it("throws for impossible overlay kinds when forced via unsafe casts", () => {
    setupDom();
    const ctx = createCtx();

    expect(() =>
      openOverlay(
        ctx,
        "invalid" as unknown as import("../webview-src/state/overlayState.js").OverlayKind,
      ),
    ).toThrow();

    ctx.state.activeOverlay = { kind: "invalid" as never };
    expect(() => closeOverlay(ctx)).toThrow();
  });
});
