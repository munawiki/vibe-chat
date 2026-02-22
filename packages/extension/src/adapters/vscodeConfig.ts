import * as vscode from "vscode";
import { stripTrailingSlashes } from "../util/strings.js";

export function getBackendUrl(): string {
  const cfg = vscode.workspace.getConfiguration("vscodeChat");
  const url = cfg.get<string>("backendUrl");
  if (!url) {
    throw new Error("vscodeChat.backendUrl is required");
  }
  return stripTrailingSlashes(url);
}

export function autoConnectEnabled(): boolean {
  return vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true);
}
