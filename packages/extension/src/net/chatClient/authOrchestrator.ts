import type * as vscode from "vscode";
import type { AuthOrchestratorDeps } from "./types.js";

export class AuthOrchestrator {
  constructor(private readonly deps: AuthOrchestratorDeps) {}

  start(registerDisposable: (disposable: vscode.Disposable) => void): void {
    registerDisposable(
      this.deps.onDidChangeGitHubSessions(() => {
        void this.refreshAuthState().catch((err) => {
          this.deps.output.warn(`auth refresh failed: ${String(err)}`);
        });
      }),
    );

    void this.refreshAuthState().catch((err) => {
      this.deps.output.warn(`initial auth refresh failed: ${String(err)}`);
    });
  }

  async refreshAuthState(): Promise<void> {
    await this.deps.run({ type: "auth/refresh.requested" });
  }

  async signIn(): Promise<void> {
    await this.deps.run({ type: "ui/signIn" });
    this.deps.output.info("GitHub session acquired.");
  }

  async signOut(): Promise<void> {
    await this.deps.run({ type: "ui/signOut" });
  }

  async connectInteractive(): Promise<void> {
    const backendUrl = this.deps.getBackendUrl();
    await this.deps.run({ type: "ui/connect", origin: "user", backendUrl, interactive: true });
  }

  async connectIfSignedIn(): Promise<boolean> {
    const backendUrl = this.deps.getBackendUrl();
    await this.deps.run({ type: "ui/connect", origin: "user", backendUrl, interactive: false });
    return this.deps.getState().status === "connected";
  }

  async signInAndConnect(): Promise<void> {
    await this.connectInteractive();
  }

  disconnect(): void {
    void this.deps.run({ type: "ui/disconnect" }).catch((err) => {
      this.deps.output.warn(`disconnect failed: ${String(err)}`);
    });
  }
}
