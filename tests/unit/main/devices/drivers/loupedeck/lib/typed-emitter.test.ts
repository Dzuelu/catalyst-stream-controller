import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/typed-emitter';

// ─── Test event map ──────────────────────────────────────────
interface TestEvents {
  data: (payload: Buffer) => void;
  error: (err: Error) => void;
  close: () => void;
}

// ──────────────────────────────────────────────────────────────
describe('TypedEmitter', () => {
  it('on() / emit() routes events with correct arguments', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn((_payload: Buffer) => {});
    emitter.on('data', fn);
    const buf = Buffer.from('hello');
    emitter.emit('data', buf);
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toBe(buf);
  });

  it('once() fires listener only once', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn(() => {});
    emitter.once('close', fn);
    emitter.emit('close');
    emitter.emit('close');
    expect(fn.mock.calls.length).toBe(1);
  });

  it('off() removes a specific listener', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn(() => {});
    emitter.on('close', fn);
    emitter.off('close', fn);
    emitter.emit('close');
    expect(fn.mock.calls.length).toBe(0);
  });

  it('addListener() is equivalent to on()', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn(() => {});
    emitter.addListener('close', fn);
    emitter.emit('close');
    expect(fn.mock.calls.length).toBe(1);
  });

  it('removeListener() removes a specific listener', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn(() => {});
    emitter.on('close', fn);
    emitter.removeListener('close', fn);
    emitter.emit('close');
    expect(fn.mock.calls.length).toBe(0);
  });

  it('removeAllListeners() clears all listeners for an event', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn1 = vi.fn(() => {});
    const fn2 = vi.fn(() => {});
    emitter.on('close', fn1);
    emitter.on('close', fn2);
    emitter.removeAllListeners('close');
    emitter.emit('close');
    expect(fn1.mock.calls.length).toBe(0);
    expect(fn2.mock.calls.length).toBe(0);
  });

  it('removeAllListeners() without argument clears everything', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn1 = vi.fn(() => {});
    const fn2 = vi.fn((_payload: Buffer) => {});
    emitter.on('close', fn1);
    emitter.on('data', fn2);
    emitter.removeAllListeners();
    emitter.emit('close');
    emitter.emit('data', Buffer.alloc(0));
    expect(fn1.mock.calls.length).toBe(0);
    expect(fn2.mock.calls.length).toBe(0);
  });

  it('emit() returns true when listeners exist, false otherwise', () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(emitter.emit('close')).toBe(false);
    emitter.on('close', () => {});
    expect(emitter.emit('close')).toBe(true);
  });

  it('supports subclassing', () => {
    class MyEmitter extends TypedEmitter<TestEvents> {
      trigger(): void {
        this.emit('close');
      }
    }
    const emitter = new MyEmitter();
    const fn = vi.fn(() => {});
    emitter.on('close', fn);
    emitter.trigger();
    expect(fn.mock.calls.length).toBe(1);
  });

  it('passes multi-arg events correctly', () => {
    interface Multi {
      move: (x: number, y: number) => void;
    }
    const emitter = new TypedEmitter<Multi>();
    const fn = vi.fn((_x: number, _y: number) => {});
    emitter.on('move', fn);
    emitter.emit('move', 10, 20);
    expect(fn.mock.calls[0]).toEqual([10, 20]);
  });
});
