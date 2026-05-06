import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Mock for the `ws` module (WebSocket).
 *
 * Usage in tests:
 *   import { getLastMockWebSocket, resetMockWS } from '../mocks/ws';
 *   const ws = getLastMockWebSocket();
 *   ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
 */

let lastInstance: MockWebSocket | null = null;

class MockWebSocket extends EventEmitter {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  CONNECTING = 0 as const;
  OPEN = 1 as const;
  CLOSING = 2 as const;
  CLOSED = 3 as const;

  readyState: number = MockWebSocket.OPEN;
  url: string;

  send = vi.fn((_data: string | Buffer) => {
    // no-op by default — tests can inspect send.mock.calls
  });

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  });

  ping = vi.fn();
  pong = vi.fn();
  terminate = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  });

  constructor(url: string, _options?: Record<string, unknown>) {
    super();
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastInstance = this;

    // Simulate async 'open' event on next tick so the caller can attach listeners
    const emitOpen = () => {
      if (this.readyState !== MockWebSocket.CLOSED) {
        this.readyState = MockWebSocket.OPEN;
        this.emit('open');
      }
    };
    process.nextTick(emitOpen);
  }

  // ─── Test Helpers ────────────────────────────────────────────

  /** Simulate receiving a JSON message from the server */
  _receive(data: Record<string, unknown>): void {
    const buffer = Buffer.from(JSON.stringify(data));
    this.emit('message', buffer);
  }

  /** Simulate a connection error */
  _error(message: string): void {
    this.emit('error', new Error(message));
  }

  /** Simulate the server closing the connection */
  _serverClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }
}

/** Get the most recently created mock WebSocket */
export function getLastMockWebSocket(): MockWebSocket {
  if (!lastInstance) {
    throw new Error('No MockWebSocket instance created yet');
  }
  return lastInstance;
}

/** Reset the instance tracker */
export function resetMockWS(): void {
  lastInstance = null;
}

// Default export matches `import WebSocket from 'ws'`
export default MockWebSocket;
