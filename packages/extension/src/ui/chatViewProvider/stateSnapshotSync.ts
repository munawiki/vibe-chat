import { deriveChatViewModel } from "../viewModel.js";
import type { StateSnapshotSyncDeps } from "./types.js";

export class StateSnapshotSync {
  constructor(private readonly deps: StateSnapshotSyncDeps) {}

  postStateSnapshot(): void {
    const current = this.deps.client.getState();
    const vm = deriveChatViewModel(current, this.deps.getBackendUrl());
    this.deps.postMessage({ type: "ext/state", state: vm });
  }

  postDmStateSnapshot(): void {
    this.deps.postMessage(this.deps.directMessages.getStateMessage());
  }

  postPresenceSnapshot(): void {
    const msg = this.deps.presence.getSnapshotMessage();
    if (msg) this.deps.postMessage(msg);
  }

  postModerationSnapshot(): void {
    const msg = this.deps.moderation.getSnapshotMessage();
    if (msg) this.deps.postMessage(msg);
  }

  postAllSnapshots(): void {
    this.postStateSnapshot();
    this.postDmStateSnapshot();
    this.postPresenceSnapshot();
    this.postModerationSnapshot();
  }
}
