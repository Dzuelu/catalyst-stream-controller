import { describe, it, expect, vi } from 'vitest';
import { WriteQueue } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/protocol/write-queue';

describe('WriteQueue', () => {
  it('processes a single enqueued item immediately', async () => {
    const writeFn = vi.fn();
    const q = new WriteQueue(writeFn);
    q.enqueue(Buffer.from([0x01]));
    await q.flush();
    expect(writeFn.mock.calls.length).toBe(1);
    expect(writeFn.mock.calls[0][0]).toEqual(Buffer.from([0x01]));
  });

  it('processes multiple items in FIFO order', async () => {
    const received: number[] = [];
    const writeFn = (data: Buffer) => {
      received.push(data[0]);
    };
    const q = new WriteQueue(writeFn);
    q.enqueue(Buffer.from([0x01]));
    q.enqueue(Buffer.from([0x02]));
    q.enqueue(Buffer.from([0x03]));
    await q.flush();
    expect(received).toEqual([0x01, 0x02, 0x03]);
  });

  it('serializes async writes (one at a time)', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const writeFn = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
    };
    const q = new WriteQueue(writeFn);
    q.enqueue(Buffer.from([0x01]));
    q.enqueue(Buffer.from([0x02]));
    q.enqueue(Buffer.from([0x03]));
    await q.flush();
    expect(maxConcurrent).toBe(1);
  });

  it('throws when queue is full', () => {
    let blocked = true;
    const q2 = new WriteQueue(
      async () => {
        while (blocked) await new Promise((r) => setTimeout(r, 1));
      },
      { maxSize: 2 }
    );
    q2.enqueue(Buffer.from([0x01]));
    q2.enqueue(Buffer.from([0x02]));
    q2.enqueue(Buffer.from([0x03]));
    expect(() => q2.enqueue(Buffer.from([0x04]))).toThrow(/Write queue full/);
    blocked = false;
  });

  it('flush() resolves immediately when idle', async () => {
    const q = new WriteQueue(() => {});
    await q.flush();
  });

  it('flush() waits for in-progress processing', async () => {
    let done = false;
    const writeFn = async () => {
      await new Promise((r) => setTimeout(r, 20));
      done = true;
    };
    const q = new WriteQueue(writeFn);
    q.enqueue(Buffer.from([0x01]));
    await q.flush();
    expect(done).toBe(true);
  });

  it('clear() discards pending writes', async () => {
    const received: number[] = [];
    let blocked = true;
    const writeFn = async (data: Buffer) => {
      if (blocked) {
        blocked = false;
        await new Promise((r) => setTimeout(r, 50));
      }
      received.push(data[0]);
    };
    const q = new WriteQueue(writeFn);
    q.enqueue(Buffer.from([0x01]));
    q.enqueue(Buffer.from([0x02]));
    q.enqueue(Buffer.from([0x03]));
    q.clear();
    expect(q.size).toBe(0);
    await q.flush();
    expect(received).toEqual([0x01]);
  });

  it('dispose() prevents further enqueues', () => {
    const q = new WriteQueue(() => {});
    q.dispose();
    expect(() => q.enqueue(Buffer.from([0x01]))).toThrow(/disposed/i);
  });

  it('reports size correctly', async () => {
    let blocked = true;
    const q = new WriteQueue(async () => {
      while (blocked) await new Promise((r) => setTimeout(r, 1));
    });
    expect(q.size).toBe(0);
    expect(q.idle).toBe(true);
    q.enqueue(Buffer.from([0x01]));
    q.enqueue(Buffer.from([0x02]));
    expect(q.size).toBe(1);
    expect(q.idle).toBe(false);
    blocked = false;
    await q.flush();
    expect(q.size).toBe(0);
    expect(q.idle).toBe(true);
  });

  it('supports sync write functions', async () => {
    const received: number[] = [];
    const q = new WriteQueue((data: Buffer) => {
      received.push(data[0]);
    });
    q.enqueue(Buffer.from([0xaa]));
    q.enqueue(Buffer.from([0xbb]));
    await q.flush();
    expect(received).toEqual([0xaa, 0xbb]);
  });

  it('continues processing after a write function error', async () => {
    const received: number[] = [];
    const writeFn = async (data: Buffer) => {
      if (data[0] === 0x02) throw new Error('write failed');
      received.push(data[0]);
    };
    const q = new WriteQueue(writeFn);
    q.enqueue(Buffer.from([0x01]));
    q.enqueue(Buffer.from([0x02]));
    q.enqueue(Buffer.from([0x03]));
    await q.flush();
    expect(received).toEqual([0x01, 0x03]);
  });
});
