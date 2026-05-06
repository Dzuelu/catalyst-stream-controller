/**
 * Options for constructing a WriteQueue.
 */
export interface WriteQueueOptions {
  /** Maximum number of queued items before `enqueue()` throws (default: 256). */
  maxSize?: number;
}

/**
 * A FIFO write queue that serializes outgoing writes.
 *
 * Accepts data via {@link enqueue}, processes items one at a time
 * through the provided write function, and provides overflow
 * protection via a configurable maximum queue size.
 *
 * Design goals:
 * - Prevent overwhelming a device with rapid-fire writes
 * - Serialize async writes (e.g. Web Serial)
 * - Provide queue size tracking for monitoring / backpressure
 * - Support `flush()` to wait for all pending writes
 * - Cleanly clear on disconnect via `clear()` / `dispose()`
 */
export class WriteQueue {
  private queue: Buffer[] = [];
  private processing = false;
  private disposed = false;
  private readonly maxSize: number;
  private readonly writeFn: (data: Buffer) => void | Promise<void>;

  /** Resolvers for pending `flush()` callers. */
  private flushResolvers: (() => void)[] = [];

  constructor(writeFn: (data: Buffer) => void | Promise<void>, options: WriteQueueOptions = {}) {
    this.writeFn = writeFn;
    this.maxSize = options.maxSize ?? 256;
  }

  /**
   * Add data to the write queue.
   *
   * @throws If the queue has been disposed.
   * @throws If the queue is at capacity ({@link maxSize}).
   */
  enqueue(data: Buffer): void {
    if (this.disposed) throw new Error('WriteQueue has been disposed');
    if (this.queue.length >= this.maxSize) {
      throw new Error(`Write queue full (${this.maxSize} pending writes)`);
    }
    this.queue.push(data);
    if (!this.processing) void this.process();
  }

  /**
   * Returns a promise that resolves when all currently queued
   * writes have been processed.
   *
   * If the queue is already empty and idle, resolves immediately.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) return;
    return new Promise<void>((resolve) => {
      this.flushResolvers.push(resolve);
    });
  }

  /** Discard all pending writes without processing them. */
  clear(): void {
    this.queue.length = 0;
    this.resolveFlushers();
  }

  /**
   * Permanently disable the queue and discard pending writes.
   *
   * After disposal, any call to {@link enqueue} will throw.
   */
  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  /** Number of items waiting to be written. */
  get size(): number {
    return this.queue.length;
  }

  /** `true` when the queue is empty and not currently processing. */
  get idle(): boolean {
    return this.queue.length === 0 && !this.processing;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const data = this.queue.shift()!;
        try {
          await this.writeFn(data);
        } catch {
          // Write errors are swallowed — the transport layer handles
          // error detection via response timeouts / state changes.
        }
      }
    } finally {
      this.processing = false;
      this.resolveFlushers();
    }
  }

  private resolveFlushers(): void {
    const resolvers = this.flushResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}
