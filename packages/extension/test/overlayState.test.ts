import { describe, expect, it } from "vitest";
import { reduceActiveOverlay } from "../webview-src/state/overlayState.js";
import type { ActiveOverlay } from "../webview-src/state/overlayState.js";

describe("reduceActiveOverlay", () => {
  it("replaces presence → profile (single active overlay)", () => {
    const prev: ActiveOverlay = { kind: "presence" };
    const next = reduceActiveOverlay(prev, { type: "overlay.open", kind: "profile" });
    expect(next).toEqual({ kind: "profile" });
  });

  it("replaces profile → presence (single active overlay)", () => {
    const prev: ActiveOverlay = { kind: "profile" };
    const next = reduceActiveOverlay(prev, { type: "overlay.open", kind: "presence" });
    expect(next).toEqual({ kind: "presence" });
  });

  it("closes the active overlay via Escape-like close event", () => {
    const prev: ActiveOverlay = { kind: "profile" };
    const next = reduceActiveOverlay(prev, { type: "overlay.close" });
    expect(next).toEqual({ kind: "none" });
  });
});
