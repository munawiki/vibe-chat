import * as vscode from "vscode";

export function getBackendUrlFromConfig(): string | undefined {
  try {
    return vscode.workspace.getConfiguration("vscodeChat").get<string>("backendUrl");
  } catch {
    return undefined;
  }
}

export function isAutoConnectEnabledFromConfig(): boolean {
  try {
    return vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true);
  } catch {
    return true;
  }
}
