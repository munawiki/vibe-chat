import * as vscode from "vscode";
import { ChatClient } from "./net/chatClient.js";
import { ChatViewProvider } from "./ui/chatViewProvider.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("VS Code Chat", { log: true });
  const client = new ChatClient(output);
  const provider = new ChatViewProvider(context, client, output);

  context.subscriptions.push(
    output,
    client,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("vscodeChat.openChat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.vscodeChat");
    }),
    vscode.commands.registerCommand("vscodeChat.signIn", async () => {
      await client.signIn();
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
}

export function deactivate(): void {}
