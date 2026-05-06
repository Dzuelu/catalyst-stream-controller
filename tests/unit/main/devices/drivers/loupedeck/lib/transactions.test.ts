import { describe, it, expect } from 'vitest';
import { TransactionManager } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/protocol/transactions';

describe('TransactionManager', () => {
  it('allocates sequential IDs starting at 1', () => {
    const tm = new TransactionManager();
    const { transactionId: id1, promise: p1 } = tm.allocate();
    const { transactionId: id2, promise: p2 } = tm.allocate();
    const { transactionId: id3, promise: p3 } = tm.allocate();
    p1.catch(() => {});
    p2.catch(() => {});
    p3.catch(() => {});
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
    tm.dispose();
  });

  it('skips ID 0 (wraps 255 → 1)', () => {
    const tm = new TransactionManager();
    for (let i = 0; i < 255; i++) {
      tm.allocate().promise.catch(() => {});
    }
    const { transactionId, promise } = tm.allocate();
    promise.catch(() => {});
    expect(transactionId).toBe(1);
    tm.dispose();
  });

  it('resolves a pending transaction', async () => {
    const tm = new TransactionManager();
    const { transactionId, promise } = tm.allocate();
    tm.resolve(transactionId, 'hello');
    expect(await promise).toBe('hello');
  });

  it('returns false when resolving unknown ID', () => {
    const tm = new TransactionManager();
    expect(tm.resolve(99, 'nope')).toBe(false);
  });

  it('times out after the configured duration', async () => {
    const tm = new TransactionManager(50);
    const { promise } = tm.allocate();
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it('rejects superseded transactions when ID is reused', async () => {
    const tm = new TransactionManager(60_000);
    const first = tm.allocate();
    for (let i = 0; i < 254; i++) tm.allocate().promise.catch(() => {});
    tm.allocate().promise.catch(() => {});
    await expect(first.promise).rejects.toThrow(/superseded/i);
    tm.dispose();
  });

  it('rejects all pending on rejectAll()', async () => {
    const tm = new TransactionManager(60_000);
    const { promise: p1 } = tm.allocate();
    const { promise: p2 } = tm.allocate();
    tm.rejectAll(new Error('disconnected'));
    await expect(p1).rejects.toThrow(/disconnected/i);
    await expect(p2).rejects.toThrow(/disconnected/i);
    expect(tm.size).toBe(0);
  });

  it('tracks pending count', () => {
    const tm = new TransactionManager(60_000);
    expect(tm.size).toBe(0);
    const { transactionId: id1 } = tm.allocate();
    tm.allocate().promise.catch(() => {});
    expect(tm.size).toBe(2);
    tm.resolve(id1, null);
    expect(tm.size).toBe(1);
    tm.dispose();
  });

  it('disposes all timers and rejects pending', async () => {
    const tm = new TransactionManager(60_000);
    const { promise } = tm.allocate();
    tm.dispose();
    await expect(promise).rejects.toThrow(/disposed/i);
    expect(tm.size).toBe(0);
  });
});
