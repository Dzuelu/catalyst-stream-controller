import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockTransport, delay } from './helpers';
import { LoupedeckLive } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/devices/loupedeck-live';
import { LoupedeckCT } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/devices/loupedeck-ct';
import { RazerStreamControllerX } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/devices/razer-stream-controller-x';
import { type LoupedeckDevice } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/devices/base';
import { COMMANDS } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/constants';
import type { DeviceOptions } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/types';

// ─── Helper: create a device with a mock transport wired via connect() ────
async function createDevice<T extends LoupedeckDevice>(
  DeviceClass: new (opts?: DeviceOptions) => T
): Promise<{ device: T; transport: MockTransport }> {
  const transport = new MockTransport();
  const device = new DeviceClass();
  device.transport = transport; // state = 'disconnected'
  await device.connect(); // wireTransport + transport.connect()
  transport.sent = []; // clear any connect-time messages
  return { device, transport };
}

/** Build a raw protocol message: [length][command][txId][payload...] */
function rawMsg(command: number, txId: number, payload: number[]): Buffer {
  const len = 3 + payload.length;
  return Buffer.from([Math.min(len, 0xff), command, txId, ...payload]);
}

// ──────────────────────────────────────────────────────────────────
// Message parsing
// ──────────────────────────────────────────────────────────────────

describe('LoupedeckLive — Message Parsing', () => {
  let device: LoupedeckLive;
  let transport: MockTransport;

  beforeEach(async () => {
    ({ device, transport } = await createDevice(LoupedeckLive));
  });

  afterEach(() => {
    device.close();
  });

  it('processes button presses (down)', () => {
    const fn = vi.fn();
    device.on('down', fn);
    transport.receive(rawMsg(COMMANDS.BUTTON_PRESS, 0, [0x09, 0x00]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toEqual({ id: 2 });
  });

  it('processes button releases (up)', () => {
    const fn = vi.fn();
    device.on('up', fn);
    transport.receive(rawMsg(COMMANDS.BUTTON_PRESS, 0, [0x07, 0x01]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toEqual({ id: 0 });
  });

  it('processes clockwise knob turns', () => {
    const fn = vi.fn();
    device.on('rotate', fn);
    transport.receive(rawMsg(COMMANDS.KNOB_ROTATE, 0, [0x01, 0x01]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toEqual({ id: 'knobTL', delta: 1 });
  });

  it('processes counter-clockwise knob turns', () => {
    const fn = vi.fn();
    device.on('rotate', fn);
    transport.receive(rawMsg(COMMANDS.KNOB_ROTATE, 0, [0x05, 0xff]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toEqual({ id: 'knobCR', delta: -1 });
  });

  it('processes initial screen touches (touchstart)', () => {
    const fn = vi.fn();
    device.on('touchstart', fn);
    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x00, 0x73, 0x00, 0xe2, 0x13]));
    expect(fn.mock.calls.length).toBe(1);
    const touch = fn.mock.calls[0][0].changedTouches[0];
    expect(touch.id).toBe(0x13);
    expect(touch.x).toBe(115);
    expect(touch.y).toBe(226);
    expect(touch.target.screen).toBe('center');
    expect(touch.target.key).toBe(8);
  });

  it('processes touch moves', () => {
    const fn = vi.fn();
    device.on('touchmove', fn);
    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x00, 0x73, 0x00, 0xe2, 0x15]));
    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x00, 0x70, 0x00, 0xe5, 0x15]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0].changedTouches[0].id).toBe(0x15);
  });

  it('processes touch end events', () => {
    const fn = vi.fn();
    device.on('touchend', fn);
    transport.receive(rawMsg(COMMANDS.TOUCH_END, 0, [0x00, 0x01, 0xbf, 0x00, 0x4c, 0x12]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0].changedTouches[0].target).toEqual({ screen: 'right' });
  });

  it('processes screen and key targets from touch events', () => {
    const fn = vi.fn();
    device.on('touchstart', fn);

    // Left strip (x=34 < 60)
    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x00, 0x22, 0x00, 0x8f, 0x01]));
    expect(fn.mock.calls[0][0].changedTouches[0].target).toEqual({ screen: 'left' });

    // Center key 0: x=103, y=72 → col=0, row=0, key=0
    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x00, 0x67, 0x00, 0x48, 0x02]));
    expect(fn.mock.calls[1][0].changedTouches[0].target).toEqual({ screen: 'center', key: 0 });

    // Right strip (x=450 ≥ 420)
    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x01, 0xc2, 0x00, 0xb8, 0x03]));
    expect(fn.mock.calls[2][0].changedTouches[0].target).toEqual({ screen: 'right' });
  });

  it('tracks multiple simultaneous touches', () => {
    const touchstart = vi.fn();
    const touchend = vi.fn();
    device.on('touchstart', touchstart);
    device.on('touchend', touchend);

    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x01, 0xbf, 0x00, 0x4c, 0x01]));
    expect(touchstart.mock.calls[0][0].touches.length).toBe(1);

    transport.receive(rawMsg(COMMANDS.TOUCH, 0, [0x00, 0x00, 0x02, 0x00, 0x01, 0x02]));
    expect(touchstart.mock.calls[1][0].touches.length).toBe(2);

    transport.receive(rawMsg(COMMANDS.TOUCH_END, 0, [0x00, 0x01, 0xbf, 0x00, 0x4f, 0x01]));
    expect(touchend.mock.calls[0][0].touches.length).toBe(1);
  });

  it('resolves version transaction', async () => {
    const promise = device.send(COMMANDS.VERSION);
    expect(promise).toBeTruthy();
    transport.receive(rawMsg(COMMANDS.VERSION, 1, [0x01, 0x05, 0x20]));
    expect(await promise).toBe('1.5.32');
  });

  it('resolves serial transaction', async () => {
    const promise = device.send(COMMANDS.SERIAL)!;
    const serialStr = 'LDL1101013000396700138A0001';
    const raw = Buffer.from(`${serialStr} `);
    const msg = Buffer.alloc(3 + raw.length);
    msg[0] = 3 + raw.length;
    msg[1] = COMMANDS.SERIAL;
    msg[2] = 1;
    raw.copy(msg, 3);
    transport.receive(msg);
    expect(await promise).toBe(serialStr);
  });

  it('processes ticks without error', () => {
    expect(() => {
      transport.receive(rawMsg(COMMANDS.TICK, 0, [0x00, 0xba]));
    }).not.toThrow();
  });

  it('ignores unknown message commands', () => {
    expect(() => {
      transport.receive(rawMsg(0xff, 0, [0xff, 0xff, 0xff]));
    }).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────
// Commands
// ──────────────────────────────────────────────────────────────────

describe('LoupedeckLive — Commands', () => {
  let device: LoupedeckLive;
  let transport: MockTransport;

  beforeEach(async () => {
    ({ device, transport } = await createDevice(LoupedeckLive));
  });

  afterEach(() => {
    device.close();
  });

  it('sends brightness command', () => {
    device.setBrightness(0)?.catch(() => {});
    expect(transport.sent.length).toBe(1);
    const buf = transport.sent[0];
    expect(buf[1]).toBe(COMMANDS.SET_BRIGHTNESS);
    expect(buf[3]).toBe(0);

    device.setBrightness(1)?.catch(() => {});
    const buf2 = transport.sent[1];
    expect(buf2[3]).toBe(10);
  });

  it('sends vibrate command with default pattern', () => {
    device.vibrate()?.catch(() => {});
    const buf = transport.sent[0];
    expect(buf[1]).toBe(COMMANDS.SET_VIBRATION);
    expect(buf[3]).toBe(0x01);
  });

  it('sends vibrate with custom pattern', () => {
    device.vibrate(0x56 as any)?.catch(() => {});
    expect(transport.sent[0][3]).toBe(0x56);
  });

  it('send() returns undefined when not connected', () => {
    transport.state = 'disconnected';
    const result = device.send(COMMANDS.VERSION);
    expect(result).toBeUndefined();
    expect(transport.sent.length).toBe(0);
  });

  it('getInfo() rejects when not connected', async () => {
    transport.state = 'disconnected';
    await expect(device.getInfo()).rejects.toThrow(/not connected/i);
  });
});

// ──────────────────────────────────────────────────────────────────
// Drawing (buffer API)
// ──────────────────────────────────────────────────────────────────

describe('LoupedeckLive — Drawing', () => {
  let device: LoupedeckLive;
  let transport: MockTransport;

  beforeEach(async () => {
    ({ device, transport } = await createDevice(LoupedeckLive));
  });

  afterEach(() => {
    device.close();
  });

  it('writes pixels to left display (x=0, y=0)', () => {
    const width = 60;
    const height = 270;
    const buffer = Buffer.alloc(width * height * 2, 0);
    device.drawBuffer({ id: 'left', width, height, autoRefresh: false }, buffer).catch(() => {});

    expect(transport.sent.length).toBe(1);
    const payload = transport.sent[0].subarray(3);
    expect(payload.readUInt16BE(0)).toBe(0x004d);
    expect(payload.readUInt16BE(2)).toBe(0);
    expect(payload.readUInt16BE(4)).toBe(0);
    expect(payload.readUInt16BE(6)).toBe(width);
    expect(payload.readUInt16BE(8)).toBe(height);
  });

  it('applies center display offset [60, 0]', () => {
    const width = 360;
    const height = 270;
    const buffer = Buffer.alloc(width * height * 2, 0);
    device.drawBuffer({ id: 'center', width, height, autoRefresh: false }, buffer).catch(() => {});

    const payload = transport.sent[0].subarray(3);
    expect(payload.readUInt16BE(2)).toBe(60);
    expect(payload.readUInt16BE(4)).toBe(0);
  });

  it('applies right display offset [420, 0]', () => {
    const width = 60;
    const height = 270;
    const buffer = Buffer.alloc(width * height * 2, 0);
    device.drawBuffer({ id: 'right', width, height, autoRefresh: false }, buffer).catch(() => {});

    const payload = transport.sent[0].subarray(3);
    expect(payload.readUInt16BE(2)).toBe(420);
  });

  it('rejects buffer with wrong size', async () => {
    await expect(device.drawBuffer({ id: 'left', autoRefresh: false }, Buffer.alloc(30))).rejects.toThrow(
      /expected buffer length/i
    );
  });

  it('throws on unknown display ID', async () => {
    await expect(device.drawBuffer({ id: 'nonexistent', autoRefresh: false }, Buffer.alloc(1))).rejects.toThrow(
      /not available/i
    );
  });

  it('drawKey computes correct position for key index', () => {
    const keySize = 90;
    const buffer = Buffer.alloc(keySize * keySize * 2, 0);

    const mockDraw = vi.spyOn(device, 'drawBuffer').mockResolvedValue();

    // Key 6: column = 6%4 = 2, row = floor(6/4) = 1
    // x = visibleX[0] + column*keySize = 0 + 180 = 180
    // y = row*keySize = 90
    device.drawKey(6, buffer);

    const opts = mockDraw.mock.calls[0][0];
    expect(opts.x).toBe(180);
    expect(opts.y).toBe(90);
    expect(opts.width).toBe(keySize);
    expect(opts.height).toBe(keySize);
    expect(opts.id).toBe('center');
  });

  it('drawKey rejects invalid key index', () => {
    const buffer = Buffer.alloc(90 * 90 * 2);
    expect(() => device.drawKey(-1, buffer)).toThrow(/not a valid key/i);
    expect(() => device.drawKey(12, buffer)).toThrow(/not a valid key/i);
  });
});

// ──────────────────────────────────────────────────────────────────
// Connection management
// ──────────────────────────────────────────────────────────────────

describe('LoupedeckLive — Connection Management', () => {
  it('reconnects on disconnect when interval is set', async () => {
    const device = new LoupedeckLive({ reconnectInterval: 20 });
    const transport = new MockTransport();
    device.transport = transport;
    transport.state = 'connected';

    const connectMock = vi.spyOn(device, 'connect').mockResolvedValue();
    (device as unknown as { onDisconnect(e?: Error): void }).onDisconnect(new Error('lost'));
    await delay(50);
    expect(connectMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    device.close();
  });

  it('does not reconnect when interval is 0', async () => {
    const device = new LoupedeckLive({ reconnectInterval: 0 });
    const transport = new MockTransport();
    device.transport = transport;
    transport.state = 'connected';

    const connectMock = vi.spyOn(device, 'connect').mockResolvedValue();
    (device as unknown as { onDisconnect(e?: Error): void }).onDisconnect(new Error('lost'));
    await delay(50);
    expect(connectMock.mock.calls.length).toBe(0);
    device.close();
  });

  it('does not reconnect on graceful close (no error)', async () => {
    const device = new LoupedeckLive({ reconnectInterval: 20 });
    const transport = new MockTransport();
    device.transport = transport;

    const connectMock = vi.spyOn(device, 'connect').mockResolvedValue();
    (device as unknown as { onDisconnect(e?: Error): void }).onDisconnect();
    await delay(50);
    expect(connectMock.mock.calls.length).toBe(0);
    device.close();
  });
});

// ──────────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────────

describe('LoupedeckLive — Edge Cases', () => {
  it('transaction IDs never reach zero', async () => {
    const { device, transport } = await createDevice(LoupedeckLive);
    for (let i = 0; i < 260; i++) {
      device.send(COMMANDS.VERSION)?.catch(() => {});
    }
    for (const buf of transport.sent) {
      expect(buf[2]).not.toBe(0);
    }
    device.close();
  });
});

// ──────────────────────────────────────────────────────────────────
// LoupedeckCT-specific
// ──────────────────────────────────────────────────────────────────

describe('LoupedeckCT — Touch targets', () => {
  it('routes knob display touches (id=0) to knob screen', async () => {
    const { device, transport } = await createDevice(LoupedeckCT);
    const fn = vi.fn();
    device.on('touchstart', fn);
    transport.receive(rawMsg(COMMANDS.TOUCH_CT, 0, [0x00, 0x00, 0x50, 0x00, 0x50, 0x00]));
    expect(fn.mock.calls[0][0].changedTouches[0].target).toEqual({ screen: 'knob' });
    device.close();
  });
});

// ──────────────────────────────────────────────────────────────────
// RazerStreamControllerX-specific
// ──────────────────────────────────────────────────────────────────

describe('RazerStreamControllerX — Specifics', () => {
  it('has 5×3 grid with 96px key size', () => {
    const device = new RazerStreamControllerX();
    expect(device.columns).toBe(5);
    expect(device.rows).toBe(3);
    expect(device.keySize).toBe(96);
  });

  it('button press emits synthetic touch events', async () => {
    const { device, transport } = await createDevice(RazerStreamControllerX);
    const down = vi.fn();
    const touchstart = vi.fn();
    device.on('down', down);
    device.on('touchstart', touchstart);

    transport.receive(rawMsg(COMMANDS.BUTTON_PRESS, 0, [0x1b, 0x00]));
    expect(down.mock.calls.length).toBe(1);
    expect(touchstart.mock.calls.length).toBe(1);
    expect(touchstart.mock.calls[0][0].changedTouches[0].target.key).toBe(0);
    device.close();
  });

  it('vibrate() throws', () => {
    const device = new RazerStreamControllerX();
    expect(() => (device as any).vibrate()).toThrow(/not available/i);
  });

  it('setButtonColor() throws', () => {
    const device = new RazerStreamControllerX();
    expect(() => (device as any).setButtonColor({ id: 0, color: '#ff0000' })).toThrow(/not available/i);
  });
});
