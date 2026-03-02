export type { DmThread } from "./directMessages/threadManager.js";
export { getOrCreateThread, getPeerForWelcome } from "./directMessages/threadManager.js";
export {
  applyObservedPeerIdentityToThread,
  applyPeerIdentityFromMessage,
  applyWelcomePeerIdentity,
  pickIdentityByPublicKey,
} from "./directMessages/peerIdentity.js";
export { emitSecretMigrationDiagnostic, emitTrustTransitionDiagnostic } from "./directMessages/diagnostics.js";
