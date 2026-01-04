import { describe, expect, it } from "vitest";
import { isComposerSendKeydown } from "../webview-src/features/chat.js";

describe("chat composer keybindings", () => {
  it("treats IME key=Process + code=Enter as send intent", () => {
    expect(isComposerSendKeydown({ key: "Process", code: "Enter", shiftKey: false })).toBe(true);
  });

  it("supports NumpadEnter", () => {
    expect(isComposerSendKeydown({ key: "Process", code: "NumpadEnter", shiftKey: false })).toBe(
      true,
    );
  });

  it("does not send on Shift+Enter", () => {
    expect(isComposerSendKeydown({ key: "Enter", code: "Enter", shiftKey: true })).toBe(false);
    expect(isComposerSendKeydown({ key: "Process", code: "Enter", shiftKey: true })).toBe(false);
  });

  it("ignores non-enter keys", () => {
    expect(isComposerSendKeydown({ key: "Process", code: "KeyA", shiftKey: false })).toBe(false);
  });
});
