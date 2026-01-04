export class PresenceBroadcastCoalescer<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingExclude = new Set<T>();

  constructor(
    private readonly windowMs: number,
    private readonly flush: (exclude: ReadonlySet<T>) => void,
  ) {}

  request(opts?: { exclude?: T }): void {
    if (opts?.exclude) this.pendingExclude.add(opts.exclude);
    if (this.timer !== null) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      const exclude = this.pendingExclude;
      this.pendingExclude = new Set();
      this.flush(exclude);
    }, this.windowMs);
  }
}
