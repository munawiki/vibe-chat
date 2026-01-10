/**
 * Overlay state is modeled as a single discriminated union.
 *
 * Why:
 * - "At most one overlay is visible" is a UX + accessibility invariant.
 * - Encoding this as a union makes "two overlays open" unrepresentable.
 *
 * Invariants:
 * - `kind: "none"` means no overlay is visible.
 * - `kind: "profile" | "presence"` means exactly that overlay is visible.
 */
export type OverlayKind = "profile" | "presence";

export type ActiveOverlay = { kind: "none" } | { kind: OverlayKind };

export type OverlayEvent = { type: "overlay.open"; kind: OverlayKind } | { type: "overlay.close" };

function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`);
}

export function reduceActiveOverlay(prev: ActiveOverlay, event: OverlayEvent): ActiveOverlay {
  switch (event.type) {
    case "overlay.open":
      return { kind: event.kind };
    case "overlay.close":
      return { kind: "none" };
    default:
      assertNever(event);
      return prev;
  }
}
