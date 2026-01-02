export type ChatUnreadState = Readonly<{ unreadCount: number }>;

export type ChatUnreadEvent =
  | Readonly<{ type: "view/visibility.changed"; visible: boolean }>
  | Readonly<{ type: "server/message.new"; viewVisible: boolean }>;

export type UnreadBadgeModel = Readonly<{ value: number; tooltip: string }>;

export function initialChatUnreadState(): ChatUnreadState {
  return { unreadCount: 0 };
}

export function reduceChatUnread(state: ChatUnreadState, event: ChatUnreadEvent): ChatUnreadState {
  switch (event.type) {
    case "view/visibility.changed":
      if (event.visible) return { unreadCount: 0 };
      return state;
    case "server/message.new":
      if (event.viewVisible) return state;
      return { unreadCount: state.unreadCount + 1 };
  }
}

export function deriveUnreadBadge(unreadCount: number): UnreadBadgeModel | undefined {
  if (unreadCount <= 0) return undefined;
  const tooltip = unreadCount === 1 ? "1 unread message" : `${unreadCount} unread messages`;
  return { value: unreadCount, tooltip };
}
