import { describe, it, expect } from 'vitest';
import { BaseTransport } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/transports/transport';
import type { TransportType, ConnectionState } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/types';

/** Minimal concrete transport for testing the state machine */
class TestTransport extends BaseTransport {
  readonly type: TransportType = 'serial';
  connectBehavior: () => Promise<void> = async () => {
    this.setState('connected');
  };
  closeBehavior: () => Promise<void> = async () => {};
  sendBehavior: ((data: Buffer) => void | Promise<void>) | null = null;
  lastSent: Buffer | null = null;
  allSent: Buffer[] = [];

  /** Expose protected setState for testing */
  public override setState(state: ConnectionState): void {
    super.setState(state);
  }

  protected async _connect(): Promise<void> {
    await this.connectBehavior();
  }

  protected async _close(): Promise<void> {
    await this.closeBehavior();
  }

  protected _send(data: Buffer): void {
    this.lastSent = data;
    this.allSent.push(Buffer.from(data));
  }
}

describe('BaseTransport state machine', () => {
  it('starts in disconnected state', () => {
    const t = new TestTransport();
    expect(t.state).toBe('disconnected');
    expect(t.isReady()).toBe(false);
  });

  it('transitions to connected on successful connect()', async () => {
    const t = new TestTransport();
    await t.connect();
    expect(t.state).toBe('connected');
    expect(t.isReady()).toBe(true);
  });

  it('emits state-change events during connect', async () => {
    const t = new TestTransport();
    const states: [ConnectionState, ConnectionState][] = [];
    t.on('state-change', (next, prev) => states.push([next, prev]));
    await t.connect();
    expect(states).toEqual([
      ['connecting', 'disconnected'],
      ['connected', 'connecting']
    ]);
  });

  it('supports handshaking intermediate state', async () => {
    const t = new TestTransport();
    t.connectBehavior = async () => {
      t.setState('handshaking');
      t.setState('connected');
    };
    const states: ConnectionState[] = [];
    t.on('state-change', (s) => states.push(s));
    await t.connect();
    expect(states).toEqual(['connecting', 'handshaking', 'connected']);
  });

  it('is a no-op when already connected', async () => {
    const t = new TestTransport();
    await t.connect();
    await t.connect();
    expect(t.state).toBe('connected');
  });

  it('throws when connecting from non-disconnected state', async () => {
    const t = new TestTransport();
    t.connectBehavior = async () => {
      await new Promise(() => {});
    };
    const p = t.connect();
    await expect(t.connect()).rejects.toThrow(/Cannot connect while in state/);
    void p.catch(() => {});
  });

  it('reverts to disconnected on connect failure', async () => {
    const t = new TestTransport();
    t.connectBehavior = async () => {
      throw new Error('connection refused');
    };
    await expect(t.connect()).rejects.toThrow(/connection refused/);
    expect(t.state).toBe('disconnected');
  });

  it('transitions to disconnected on close()', async () => {
    const t = new TestTransport();
    await t.connect();
    const states: ConnectionState[] = [];
    t.on('state-change', (s) => states.push(s));
    await t.close();
    expect(t.state).toBe('disconnected');
    expect(states).toContain('disconnecting');
    expect(states).toContain('disconnected');
  });

  it('close() is a no-op when already disconnected', async () => {
    const t = new TestTransport();
    await t.close();
    expect(t.state).toBe('disconnected');
  });

  it('send() works when connected', async () => {
    const t = new TestTransport();
    await t.connect();
    const data = Buffer.from([0x01, 0x02]);
    t.send(data);
    expect(t.lastSent).toEqual(data);
  });

  it('send() throws when not connected', () => {
    const t = new TestTransport();
    expect(() => t.send(Buffer.from([0x01]))).toThrow(/Cannot send/);
  });

  it('rejects invalid state transitions', async () => {
    const t = new TestTransport();
    expect(() => t.setState('connected')).toThrow(/Invalid transport state transition/);
  });
});

describe('BaseTransport write queue', () => {
  it('routes send() through the write queue to _send()', async () => {
    const t = new TestTransport();
    await t.connect();
    t.send(Buffer.from([0x01, 0x02]));
    await t.flushWrites();
    expect(t.lastSent).toEqual(Buffer.from([0x01, 0x02]));
  });

  it('records all sends in order', async () => {
    const t = new TestTransport();
    await t.connect();
    t.send(Buffer.from([0x01]));
    t.send(Buffer.from([0x02]));
    t.send(Buffer.from([0x03]));
    await t.flushWrites();
    expect(t.allSent.length).toBe(3);
    expect(t.allSent.map((b) => b[0])).toEqual([0x01, 0x02, 0x03]);
  });

  it('reports pendingWrites count', async () => {
    const t = new TestTransport();
    await t.connect();
    expect(t.pendingWrites).toBe(0);
    t.send(Buffer.from([0x01]));
    await t.flushWrites();
    expect(t.pendingWrites).toBe(0);
  });

  it('clears write queue on close()', async () => {
    const t = new TestTransport();
    await t.connect();
    await t.close();
    expect(t.pendingWrites).toBe(0);
  });

  it('flushWrites() resolves immediately when idle', async () => {
    const t = new TestTransport();
    await t.connect();
    await t.flushWrites();
  });
});
