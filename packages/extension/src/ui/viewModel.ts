import { ChatClientState } from "../net/chatClient.js";

export type ChatHeaderAction = {
  visible: boolean;
  enabled: boolean;
  label: string;
};

export type ChatViewModel = ChatClientState & {
  actions: {
    signIn: ChatHeaderAction;
    connect: ChatHeaderAction;
  };
};

export function deriveChatViewModel(state: ChatClientState, backendUrl?: string): ChatViewModel {
  const base = backendUrl ? { ...state, backendUrl } : state;

  if (base.status === "connecting") {
    return {
      ...base,
      actions: {
        signIn: { visible: false, enabled: false, label: "Sign in with GitHub" },
        connect: { visible: false, enabled: false, label: "Connect" },
      },
    };
  }

  if (base.authStatus === "signedOut") {
    return {
      ...base,
      actions: {
        signIn: { visible: true, enabled: true, label: "Sign in with GitHub" },
        connect: { visible: false, enabled: false, label: "Connect" },
      },
    };
  }

  if (base.status === "disconnected") {
    return {
      ...base,
      actions: {
        signIn: { visible: false, enabled: false, label: "Sign in with GitHub" },
        connect: { visible: true, enabled: true, label: "Connect" },
      },
    };
  }

  return {
    ...base,
    actions: {
      signIn: { visible: false, enabled: false, label: "Sign in with GitHub" },
      connect: { visible: false, enabled: false, label: "Connect" },
    },
  };
}
