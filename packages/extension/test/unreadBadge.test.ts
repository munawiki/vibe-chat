import { describe, expect, it } from "vitest";
import {
  deriveUnreadBadge,
  initialChatUnreadState,
  reduceChatUnread,
} from "../src/ui/unreadBadge.js";

describe("unreadBadge", () => {
  it("increments when view is not visible", () => {
    const s0 = initialChatUnreadState();
    const s1 = reduceChatUnread(s0, { type: "server/message.new", viewVisible: false });

    expect(s1.unreadCount).toBe(1);
    expect(deriveUnreadBadge(s1.unreadCount)).toEqual({ value: 1, tooltip: "1 unread message" });
  });

  it("does not increment when view is visible", () => {
    const s0 = initialChatUnreadState();
    const s1 = reduceChatUnread(s0, { type: "server/message.new", viewVisible: true });

    expect(s1.unreadCount).toBe(0);
    expect(deriveUnreadBadge(s1.unreadCount)).toBeUndefined();
  });

  it("clears when view becomes visible", () => {
    const s0 = initialChatUnreadState();
    const s1 = reduceChatUnread(s0, { type: "server/message.new", viewVisible: false });
    const s2 = reduceChatUnread(s1, { type: "server/message.new", viewVisible: false });
    const s3 = reduceChatUnread(s2, { type: "view/visibility.changed", visible: true });

    expect(s3.unreadCount).toBe(0);
    expect(deriveUnreadBadge(s3.unreadCount)).toBeUndefined();
  });
});
