import type { AuthUser } from "@vscode-chat/protocol";

export class MockWebSocket {
  private attachment: unknown;
  readonly sent: string[] = [];
  readonly closed: Array<{ code: number; reason: string }> = [];

  constructor(user?: AuthUser) {
    if (user) {
      this.serializeAttachment({ user });
    }
  }

  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(code: number, reason: string): void {
    this.closed.push({ code, reason });
  }
}
