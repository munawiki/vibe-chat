import { describe, expect, it } from "vitest";
import type { DmIdentity } from "@vscode-chat/protocol";
import {
  DM_TRUST_WARNING_BLOCKED,
  DM_TRUST_WARNING_KEY_UNAVAILABLE,
  DM_TRUST_WARNING_PENDING,
  applyObservedPeerIdentity,
  approvePendingPeerIdentity,
  canSendDm,
  dmSendBlockedReason,
  initialDmThreadTrust,
  toDmThreadView,
  type DmThreadTrust,
} from "../src/ui/chatView/directMessagesTrustPolicy.js";

function makeIdentity(publicKey: string): DmIdentity {
  return {
    cipherSuite: "nacl.box.v1",
    publicKey,
  };
}

describe("directMessagesTrustPolicy", () => {
  it("starts in key-unavailable state", () => {
    expect(initialDmThreadTrust()).toEqual({
      state: "key-unavailable",
      warning: DM_TRUST_WARNING_KEY_UNAVAILABLE,
    });
  });

  it("transitions missing/untrusted/trusted identities deterministically", () => {
    const trusted = makeIdentity("k2");
    const untrusted = makeIdentity("k2");

    const s1 = applyObservedPeerIdentity(initialDmThreadTrust(), { kind: "missing" });
    expect(s1.state).toBe("key-unavailable");

    const s2 = applyObservedPeerIdentity(s1, { kind: "untrusted", identity: untrusted });
    expect(s2.state).toBe("pending-trust");
    expect(s2.pendingPeerIdentity?.publicKey).toBe("k2");

    const s3 = applyObservedPeerIdentity(s2, { kind: "trusted", identity: trusted });
    expect(s3.state).toBe("trusted");
    expect(s3.peerIdentity?.publicKey).toBe("k2");
  });

  it("keeps pending-trust state when a mismatched trusted key arrives", () => {
    const pendingState: DmThreadTrust = {
      state: "pending-trust",
      pendingPeerIdentity: makeIdentity("k2"),
      warning: DM_TRUST_WARNING_PENDING,
    };

    const next = applyObservedPeerIdentity(pendingState, {
      kind: "trusted",
      identity: makeIdentity("k1"),
    });
    expect(next).toBe(pendingState);
  });

  it("approves pending key and blocks malformed pending state", () => {
    const pendingState: DmThreadTrust = {
      state: "pending-trust",
      pendingPeerIdentity: makeIdentity("k2"),
      warning: DM_TRUST_WARNING_PENDING,
    };
    const approved = approvePendingPeerIdentity(pendingState);
    expect(approved.state).toBe("trusted");
    expect(approved.peerIdentity?.publicKey).toBe("k2");

    const malformedPending: DmThreadTrust = {
      state: "pending-trust",
      warning: "custom warning",
    };
    const blocked = approvePendingPeerIdentity(malformedPending);
    expect(blocked.state).toBe("blocked");
    expect(blocked.warning).toBe("custom warning");
  });

  it("exposes send guard, blocked reason, and thread view consistently", () => {
    const trusted: DmThreadTrust = {
      state: "trusted",
      peerIdentity: makeIdentity("k1"),
    };
    expect(canSendDm(trusted)).toBe(true);
    expect(toDmThreadView(trusted)).toEqual({
      isBlocked: false,
      canTrustKey: false,
    });

    const pending: DmThreadTrust = {
      state: "pending-trust",
      pendingPeerIdentity: makeIdentity("k2"),
      warning: DM_TRUST_WARNING_PENDING,
    };
    expect(canSendDm(pending)).toBe(false);
    expect(dmSendBlockedReason(pending)).toBe(DM_TRUST_WARNING_PENDING);
    expect(toDmThreadView(pending)).toEqual({
      isBlocked: true,
      canTrustKey: true,
      warning: DM_TRUST_WARNING_PENDING,
    });

    const blocked: DmThreadTrust = { state: "blocked", warning: DM_TRUST_WARNING_BLOCKED };
    expect(dmSendBlockedReason(blocked)).toBe(DM_TRUST_WARNING_BLOCKED);
  });
});
