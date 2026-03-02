import type { ServerEvent } from "@vscode-chat/protocol";
import type { ServerEventPipelineDeps } from "./types.js";

export class ServerEventPipeline {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ServerEventPipelineDeps) {}

  enqueue(event: ServerEvent): void {
    const job = async (): Promise<void> => {
      await this.deps.routeServerEvent(event);
    };

    this.chain = this.chain.then(job, job).catch((err) => {
      this.deps.output.warn(`server event handler failed: ${String(err)}`);
    });
  }

  reset(): void {
    this.chain = Promise.resolve();
  }
}
