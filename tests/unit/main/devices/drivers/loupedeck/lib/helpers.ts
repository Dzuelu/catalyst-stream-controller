import { expect } from 'vitest';
import type {
  Transport,
  TransportType,
  ConnectionState,
  TransportEvents
} from '../../../../../../../src/main/devices/drivers/loupedeck/lib/types';

/**
 * Assert that a buffer is a valid framebuffer write command.
 *
 * Packet layout: [0xff10(2)] [displayID(2)] [x(2)] [y(2)] [w(2)] [h(2)] [pixels...]
 */
export function assertIsPixelBuffer(
  received: Buffer,
  { displayID, x, y, width, height }: { displayID: number; x: number; y: number; width: number; height: number }
): void {
  expect(received.readUInt16BE(0)).toBe(0xff10);
  expect(received.readUInt16BE(3)).toBe(displayID);
  expect(received.readUInt16BE(5)).toBe(x);
  expect(received.readUInt16BE(7)).toBe(y);
  expect(received.readUInt16BE(9)).toBe(width);
  expect(received.readUInt16BE(11)).toBe(height);
  const expectedLen = 13 + width * height * 2;
  expect(received.length).toBe(expectedLen);
}

export const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * A minimal mock transport for testing device logic without real connections.
 * Records sent data and allows injecting received messages.
 */
export class MockTransport implements Transport {
  readonly type: TransportType;
  state: ConnectionState = 'disconnected';
  sent: Buffer[] = [];

  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(type: TransportType = 'serial') {
    this.type = type;
  }

  async connect(): Promise<void> {
    this.state = 'connected';
    this.emitEvent('state-change', 'connected', 'disconnected');
  }

  async close(): Promise<void> {
    this.state = 'disconnected';
    this.emitEvent('state-change', 'disconnected', 'connected');
  }

  send(data: Buffer): void {
    this.sent.push(data);
  }

  isReady(): boolean {
    return this.state === 'connected';
  }

  on<E extends keyof TransportEvents>(event: E, handler: TransportEvents[E]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
  }

  off<E extends keyof TransportEvents>(event: E, handler: TransportEvents[E]): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  /** Simulate receiving a message from the device */
  receive(data: Buffer): void {
    this.emitEvent('message', data);
  }

  /** Simulate a transport error */
  error(err: Error): void {
    this.emitEvent('error', err);
  }

  private emitEvent(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }
}
