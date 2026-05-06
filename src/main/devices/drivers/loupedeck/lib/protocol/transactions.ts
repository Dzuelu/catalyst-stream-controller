import { DEFAULT_TRANSACTION_TIMEOUT } from '../constants';

interface PendingTransaction {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages the transaction ID lifecycle for the Loupedeck protocol.
 *
 * - IDs are 1–255 (the device ignores ID 0).
 * - Each `send()` gets a unique ID and returns a Promise that resolves
 *   when the device responds with that same ID.
 * - Transactions time out after `timeoutMs` to prevent hanging promises.
 * - Stale transactions are cleaned up automatically.
 */
export class TransactionManager {
  private nextId = 0;
  private pending = new Map<number, PendingTransaction>();
  private defaultTimeout: number;

  constructor(timeoutMs: number = DEFAULT_TRANSACTION_TIMEOUT) {
    this.defaultTimeout = timeoutMs;
  }

  /** Allocate the next transaction ID (1–255, wrapping). */
  allocate(timeoutMs?: number): { transactionId: number; promise: Promise<unknown> } {
    this.nextId = (this.nextId + 1) % 256;
    // Skip 0 — firmware ignores it
    if (this.nextId === 0) this.nextId = 1;

    const id = this.nextId;
    const timeout = timeoutMs ?? this.defaultTimeout;

    // If there's an old pending transaction on this ID, reject it
    const existing = this.pending.get(id);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error(`Transaction ${id} superseded by new allocation`));
      this.pending.delete(id);
    }

    const { promise, resolve, reject } = this.createDeferredPromise();

    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`Transaction ${id} timed out after ${timeout}ms`));
    }, timeout);

    this.pending.set(id, { resolve, reject, timer });

    return { transactionId: id, promise };
  }

  /** Resolve a pending transaction with a response value. */
  resolve(transactionId: number, value: unknown): boolean {
    const tx = this.pending.get(transactionId);
    if (!tx) return false;
    clearTimeout(tx.timer);
    this.pending.delete(transactionId);
    tx.resolve(value);
    return true;
  }

  /** Reject all pending transactions (e.g. on disconnect). */
  rejectAll(reason: Error): void {
    for (const [id, tx] of this.pending) {
      clearTimeout(tx.timer);
      tx.reject(reason);
      this.pending.delete(id);
    }
  }

  /** Number of currently pending transactions. */
  get size(): number {
    return this.pending.size;
  }

  /** Clean up all timers. */
  dispose(): void {
    this.rejectAll(new Error('Transaction manager disposed'));
  }

  private createDeferredPromise(): {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  } {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}
