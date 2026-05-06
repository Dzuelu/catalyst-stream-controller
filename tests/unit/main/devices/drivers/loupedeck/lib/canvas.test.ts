import { describe, it, expect, vi } from 'vitest';
import {
  drawCanvas,
  drawCanvasKey,
  drawCanvasScreen
} from '../../../../../../../src/main/devices/drivers/loupedeck/lib/canvas';
import type {
  LoupedeckDeviceLike,
  DisplayInfo
} from '../../../../../../../src/main/devices/drivers/loupedeck/lib/types';

// ─── Helpers ──────────────────────────────────────────────────

/** Create a minimal mock device that satisfies LoupedeckDeviceLike. */
function createMockDevice(overrides: Partial<LoupedeckDeviceLike> = {}): LoupedeckDeviceLike {
  const drawBufferMock = vi.fn((_opts: unknown, _buf: unknown) => Promise.resolve());
  return {
    type: 'loupedeck-live',
    columns: 4,
    rows: 3,
    keySize: 90,
    visibleX: [0],
    displays: {
      center: {
        id: Buffer.from([0x00, 0x41]),
        width: 360,
        height: 270,
        endianness: 'le'
      } as DisplayInfo
    },
    close: () => {},
    drawBuffer: drawBufferMock as unknown as LoupedeckDeviceLike['drawBuffer'],
    on: () => {},
    ...overrides
  };
}

// ──────────────────────────────────────────────────────────────
describe('Canvas helpers', () => {
  describe('drawCanvas()', () => {
    it('throws when display ID is not found', async () => {
      const device = createMockDevice();
      await expect(() => drawCanvas(device, { id: 'nonexistent' }, () => {})).rejects.toThrow(/not available/i);
    });

    it('invokes callback and calls drawBuffer with an RGB565 buffer', async () => {
      const device = createMockDevice();
      let calledWith: [unknown, number, number] | null = null;
      await drawCanvas(device, { id: 'center', width: 2, height: 2 }, (ctx, w, h) => {
        calledWith = [ctx, w, h];
      });
      expect(calledWith).toBeTruthy();
      expect(calledWith![1]).toBe(2);
      expect(calledWith![2]).toBe(2);
      const dbMock = device.drawBuffer as ReturnType<typeof vi.fn>;
      expect(dbMock.mock.calls.length).toBe(1);
      const [opts, buf] = dbMock.mock.calls[0] as [Record<string, unknown>, Buffer];
      expect(opts.id).toBe('center');
      expect(opts.width).toBe(2);
      expect(opts.height).toBe(2);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBe(8);
    });

    it('defaults width/height from display info', async () => {
      const device = createMockDevice();
      await drawCanvas(device, { id: 'center' }, () => {});
      const dbMock = device.drawBuffer as ReturnType<typeof vi.fn>;
      const [opts] = dbMock.mock.calls[0] as [Record<string, unknown>];
      expect(opts.width).toBe(360);
      expect(opts.height).toBe(270);
    });
  });

  describe('drawCanvasKey()', () => {
    it('rejects invalid key index (negative)', async () => {
      const device = createMockDevice();
      await expect(() => drawCanvasKey(device, -1, () => {})).rejects.toThrow(/not a valid key/i);
    });

    it('rejects invalid key index (too high)', async () => {
      const device = createMockDevice();
      await expect(() => drawCanvasKey(device, 99, () => {})).rejects.toThrow(/not a valid key/i);
    });

    it('computes correct key region and calls drawBuffer', async () => {
      const device = createMockDevice();
      await drawCanvasKey(device, 5, () => {});
      const dbMock = device.drawBuffer as ReturnType<typeof vi.fn>;
      expect(dbMock.mock.calls.length).toBe(1);
      const [opts] = dbMock.mock.calls[0] as [Record<string, unknown>];
      expect(opts.id).toBe('center');
      expect(opts.x).toBe(90);
      expect(opts.y).toBe(90);
      expect(opts.width).toBe(90);
      expect(opts.height).toBe(90);
    });
  });

  describe('drawCanvasScreen()', () => {
    it('throws when display ID is not found', async () => {
      const device = createMockDevice();
      await expect(() => drawCanvasScreen(device, 'nonexistent', () => {})).rejects.toThrow(/not available/i);
    });

    it('draws full screen and calls drawBuffer', async () => {
      const device = createMockDevice();
      await drawCanvasScreen(device, 'center', () => {});
      const dbMock = device.drawBuffer as ReturnType<typeof vi.fn>;
      expect(dbMock.mock.calls.length).toBe(1);
      const [opts] = dbMock.mock.calls[0] as [Record<string, unknown>];
      expect(opts.id).toBe('center');
    });
  });
});
