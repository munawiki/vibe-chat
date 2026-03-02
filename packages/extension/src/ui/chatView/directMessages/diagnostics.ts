import type * as vscode from "vscode";
import type { DmSecretMigrationDiagnostic } from "../../../e2ee/dmCrypto.js";
import type { DmTrustState } from "../directMessagesTrustPolicy.js";

export function emitSecretMigrationDiagnostic(options: {
  output: vscode.LogOutputChannel;
  event: DmSecretMigrationDiagnostic;
  label: string;
}): void {
  const { output, event, label } = options;
  const serialized = JSON.stringify({
    boundary: event.boundary,
    phase: event.phase,
    outcome: event.outcome,
    ...(event.errorClass ? { errorClass: event.errorClass } : {}),
  });

  const text = `${label}: ${serialized}`;
  if (event.outcome === "failed") output.warn(text);
  else output.info(text);
}

export function emitTrustTransitionDiagnostic(options: {
  output: vscode.LogOutputChannel;
  label: string;
  phase: "observe_peer_identity" | "approve_pending";
  fromState: DmTrustState;
  toState: DmTrustState;
}): void {
  const serialized = JSON.stringify({
    boundary: "dm.trust.transition",
    phase: options.phase,
    outcome: options.fromState === options.toState ? "no_change" : "transitioned",
    fromState: options.fromState,
    toState: options.toState,
  });
  options.output.info(`${options.label}: ${serialized}`);
}
