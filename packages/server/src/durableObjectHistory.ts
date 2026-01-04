import type { ZodType, ZodTypeDef } from "zod";
import { appendHistory, nextHistoryPersistence } from "./policy/chatRoomPolicy.js";
import { parseZodArrayWithLimit } from "./zodUtil.js";

export type DurableObjectHistoryConfig = Readonly<{
  limit: number;
  persistEveryNEntries: number;
}>;

export class DurableObjectHistory<T> {
  /**
   * Invariant: `ready` MUST be awaited before calling `snapshot()` or `append()`.
   * This ensures the in-memory state is derived from the latest persisted snapshot.
   */
  readonly ready: Promise<void>;

  private history: T[] = [];
  private pendingPersistCount = 0;

  constructor(
    private readonly state: DurableObjectState,
    private readonly storageKey: string,
    private readonly itemSchema: ZodType<T, ZodTypeDef, unknown>,
    private readonly config: DurableObjectHistoryConfig,
  ) {
    this.ready = this.load();
  }

  snapshot(): T[] {
    return this.history.slice();
  }

  async append(entry: T): Promise<void> {
    this.history = appendHistory(this.history, entry, this.config.limit);

    const persistence = nextHistoryPersistence(
      this.pendingPersistCount,
      this.config.persistEveryNEntries,
    );
    this.pendingPersistCount = persistence.nextPendingCount;
    if (persistence.shouldPersist) {
      await this.state.storage.put(this.storageKey, this.history);
    }
  }

  private async load(): Promise<void> {
    const saved = await this.state.storage.get<unknown>(this.storageKey);
    this.history = parseZodArrayWithLimit(saved, this.itemSchema, this.config.limit);
  }
}
