import type * as vscode from "vscode";
import type { DmSecretMigrationDiagnostic } from "../../e2ee/dmCrypto.js";
import type { DmTrustState } from "./directMessagesTrustPolicy.js";
import {
  emitSecretMigrationDiagnostic,
  emitTrustTransitionDiagnostic,
} from "./directMessages/diagnostics.js";

const DM_SECRET_MIGRATION_LABEL = "dm secret migration";
const DM_TRUST_TRANSITION_LABEL = "dm trust transition";

export function emitDmSecretMigrationDiagnostic(options: {
  output: vscode.LogOutputChannel;
  event: DmSecretMigrationDiagnostic;
}): void {
  emitSecretMigrationDiagnostic({
    output: options.output,
    event: options.event,
    label: DM_SECRET_MIGRATION_LABEL,
  });
}

export function emitDmTrustTransitionDiagnostic(options: {
  output: vscode.LogOutputChannel;
  phase: "observe_peer_identity" | "approve_pending";
  fromState: DmTrustState;
  toState: DmTrustState;
}): void {
  emitTrustTransitionDiagnostic({
    output: options.output,
    label: DM_TRUST_TRANSITION_LABEL,
    phase: options.phase,
    fromState: options.fromState,
    toState: options.toState,
  });
}
