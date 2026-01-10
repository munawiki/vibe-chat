import * as vscode from "vscode";
import { ChatClient } from "./net/chatClient.js";
import { ChatViewProvider } from "./ui/chatViewProvider.js";
import { ChatStatusBar } from "./ui/chatStatusBar.js";
import { createExtensionBus } from "./bus/extensionBus.js";
import { createExtensionTelemetry } from "./telemetry.js";
import { DM_SECRET_STORAGE_KEY_V1, dmSecretStorageKeyV2 } from "./e2ee/dmCrypto.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Vibe Chat", { log: true });
  const telemetry = createExtensionTelemetry({
    output,
    getBackendUrl: () => vscode.workspace.getConfiguration("vscodeChat").get<string>("backendUrl"),
  });
  const bus = createExtensionBus();
  const client = new ChatClient(output, context.globalState, bus, telemetry);
  client.start();
  const provider = new ChatViewProvider(context, client, output, bus);
  const statusBar = new ChatStatusBar(client);

  context.subscriptions.push(
    output,
    telemetry,
    client,
    statusBar,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("vscodeChat.openChat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.vscodeChat");
    }),
    vscode.commands.registerCommand("vscodeChat.signIn", async () => {
      await client.signIn();
    }),
    vscode.commands.registerCommand("vscodeChat.signOut", async () => {
      await client.signOut();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("vscodeChat.backendUrl") ||
        e.affectsConfiguration("vscodeChat.autoConnect")
      ) {
        provider.onConfigChanged();
      }
    }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    context.subscriptions.push(
      vscode.commands.registerCommand("vscodeChat.dev.rotateDmKey", async () => {
        try {
          const state = client.getState();
          const githubUserId =
            state.authStatus === "signedIn" && state.user?.githubUserId
              ? state.user.githubUserId
              : undefined;
          if (githubUserId) {
            await context.secrets.delete(dmSecretStorageKeyV2(githubUserId));
          } else {
            await context.secrets.delete(DM_SECRET_STORAGE_KEY_V1);
          }
          vscode.window.showInformationMessage(
            "Vibe Chat: DM key cleared. Reconnect to publish a new key.",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Vibe Chat: Failed to clear DM key: ${message}`);
        }
      }),
    );
  }
}

export function deactivate(): void {}
