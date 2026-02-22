import type { DmIdentity } from "@vscode-chat/protocol";

export type DmTrustState = "trusted" | "pending-trust" | "blocked" | "key-unavailable";

export const DM_TRUST_WARNING_KEY_UNAVAILABLE = "Peer key unavailable.";
export const DM_TRUST_WARNING_PENDING = "Peer key changed. Trust the new key to continue.";
export const DM_TRUST_WARNING_BLOCKED = "DM is blocked.";

export type DmThreadTrust = {
  state: DmTrustState;
  peerIdentity?: DmIdentity;
  pendingPeerIdentity?: DmIdentity;
  warning?: string;
};

export type ObservedPeerIdentity =
  | { kind: "missing" }
  | { kind: "trusted"; identity: DmIdentity }
  | { kind: "untrusted"; identity: DmIdentity };

function blockedReasonByState(current: DmThreadTrust): string {
  switch (current.state) {
    case "pending-trust":
      return current.warning ?? DM_TRUST_WARNING_PENDING;
    case "key-unavailable":
      return current.warning ?? DM_TRUST_WARNING_KEY_UNAVAILABLE;
    case "blocked":
      return current.warning ?? DM_TRUST_WARNING_BLOCKED;
    case "trusted":
      return current.warning ?? DM_TRUST_WARNING_BLOCKED;
  }
}

export function initialDmThreadTrust(): DmThreadTrust {
  return {
    state: "key-unavailable",
    warning: DM_TRUST_WARNING_KEY_UNAVAILABLE,
  };
}

export function applyObservedPeerIdentity(
  current: DmThreadTrust,
  observed: ObservedPeerIdentity,
): DmThreadTrust {
  if (observed.kind === "missing") {
    return {
      state: "key-unavailable",
      warning: DM_TRUST_WARNING_KEY_UNAVAILABLE,
    };
  }

  if (observed.kind === "untrusted") {
    return {
      state: "pending-trust",
      ...(current.peerIdentity ? { peerIdentity: current.peerIdentity } : {}),
      pendingPeerIdentity: observed.identity,
      warning: DM_TRUST_WARNING_PENDING,
    };
  }

  if (
    current.state === "pending-trust" &&
    current.pendingPeerIdentity &&
    current.pendingPeerIdentity.publicKey !== observed.identity.publicKey
  ) {
    return current;
  }

  return {
    state: "trusted",
    peerIdentity: observed.identity,
  };
}

export function approvePendingPeerIdentity(current: DmThreadTrust): DmThreadTrust {
  if (!current.pendingPeerIdentity) {
    if (current.state === "pending-trust") {
      return {
        state: "blocked",
        ...(current.peerIdentity ? { peerIdentity: current.peerIdentity } : {}),
        warning: current.warning ?? DM_TRUST_WARNING_BLOCKED,
      };
    }
    return current;
  }

  return {
    state: "trusted",
    peerIdentity: current.pendingPeerIdentity,
  };
}

export function canSendDm(current: DmThreadTrust): boolean {
  return current.state === "trusted" && current.peerIdentity !== undefined;
}

export function dmSendBlockedReason(current: DmThreadTrust): string {
  return blockedReasonByState(current);
}

export function toDmThreadView(current: DmThreadTrust): {
  isBlocked: boolean;
  canTrustKey: boolean;
  warning?: string;
} {
  return {
    isBlocked: !canSendDm(current),
    canTrustKey: current.state === "pending-trust" && current.pendingPeerIdentity !== undefined,
    ...(current.warning ? { warning: current.warning } : {}),
  };
}
