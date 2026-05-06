import { WriteQueue } from '../protocol/write-queue';
import { TypedEmitter } from '../typed-emitter';
import type { Transport, TransportType, TransportEvents, ConnectionState } from '../types';

/**
 * Base class for all transports. Provides:
 * - Connection state machine with validated transitions
 * - Typed event emission
 * - Serialized write queue with backpressure
 * - Common guard methods
 *
 * Subclasses implement: _connect(), _close(), _send()
 */
export abstract class BaseTransport extends TypedEmitter<TransportEvents> implements Transport {
  abstract readonly type: TransportType;

  private _state: ConnectionState = 'disconnected';
  private writeQueue: WriteQueue;

  constructor() {
    super();
    this.writeQueue = new WriteQueue((data) => this._send(data));
  }

  get state(): ConnectionState {
    return this._state;
  }

  /** Valid state transitions */
  private static readonly TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
    disconnected: ['connecting'],
    connecting: ['handshaking', 'connected', 'disconnected'],
    handshaking: ['connected', 'disconnected'],
    connected: ['disconnecting', 'disconnected'],
    disconnecting: ['disconnected']
  };

  protected setState(next: ConnectionState): void {
    const allowed = BaseTransport.TRANSITIONS[this._state];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid transport state transition: ${this._state} → ${next}`);
    }
    const previous = this._state;
    this._state = next;
    this.emit('state-change', next, previous);
  }

  isReady(): boolean {
    return this._state === 'connected';
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return;
    if (this._state !== 'disconnected') {
      throw new Error(`Cannot connect while in state: ${this._state}`);
    }
    this.setState('connecting');
    try {
      await this._connect();
      // Subclass should have called setState('connected') or 'handshaking' → 'connected'
      // If still in connecting/handshaking, something went wrong
      if ((this._state as ConnectionState) !== 'connected') {
        throw new Error(`Transport did not reach 'connected' state (stuck in '${this._state}')`);
      }
    } catch (err) {
      // Force back to disconnected on failure
      this._state = 'disconnected';
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this._state === 'disconnected') return;
    if (this._state === 'disconnecting') return;
    this.setState('disconnecting');
    try {
      this.writeQueue.clear();
      await this._close();
    } finally {
      this._state = 'disconnected';
      this.emit('state-change', 'disconnected', 'disconnecting');
    }
  }

  send(data: Buffer): void {
    if (!this.isReady()) {
      throw new Error(`Cannot send while in state: ${this._state}`);
    }
    this.writeQueue.enqueue(data);
  }

  /** Wait for all queued writes to be flushed to the underlying transport. */
  async flushWrites(): Promise<void> {
    return this.writeQueue.flush();
  }

  /** Number of writes waiting in the queue. */
  get pendingWrites(): number {
    return this.writeQueue.size;
  }

  // ─── Abstract methods for subclasses ────────────────────────
  /** Perform the actual connection. Must call setState('connected') on success. */
  protected abstract _connect(): Promise<void>;
  /** Perform the actual disconnection. */
  protected abstract _close(): Promise<void>;
  /** Send raw bytes over the wire. */
  protected abstract _send(data: Buffer): void;
}
