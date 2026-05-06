import { describe, it, expect, vi } from 'vitest';
import { MagicByteLengthParser } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/protocol/parser';

describe('MagicByteLengthParser', () => {
  it('transforms data by magic byte', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x32 });
    const fn = vi.fn();
    parser.on('data', fn);
    parser.write(Buffer.from([0x32, 0x01, 0x88, 0x32]));
    parser.write(Buffer.from([0x03, 0xff, 0x32, 0xff, 0x32, 0x02, 0xaa]));
    parser.write(Buffer.from([0xab]));
    expect(fn.mock.calls.length).toBe(3);
    expect(fn.mock.calls[0][0]).toEqual(Buffer.from([0x88]));
    expect(fn.mock.calls[1][0]).toEqual(Buffer.from([0xff, 0x32, 0xff]));
    expect(fn.mock.calls[2][0]).toEqual(Buffer.from([0xaa, 0xab]));
  });

  it('handles zero length indicators', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x11 });
    const fn = vi.fn();
    parser.on('data', fn);
    parser.write(Buffer.from([0x11, 0x00, 0x11, 0x11]));
    parser.write(Buffer.alloc(0x11).fill(0xff));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toEqual(Buffer.alloc(0x11).fill(0xff));
  });

  it('does not push incomplete data on end (drops it)', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0xff });
    const dataFn = vi.fn();
    const dropFn = vi.fn();
    parser.on('data', dataFn);
    parser.on('drop', dropFn);
    parser.write(Buffer.from([0xff, 0x03, 0x00]));
    expect(dataFn.mock.calls.length).toBe(0);
    parser.end();
    expect(dataFn.mock.calls.length).toBe(0);
    expect(dropFn.mock.calls.length).toBe(1);
    expect(dropFn.mock.calls[0][0]).toEqual(Buffer.from([0xff, 0x03, 0x00]));
    expect(parser.stats.incompleteFlushes).toBe(1);
    expect(parser.stats.bytesDropped).toBe(3);
  });

  it('handles multiple complete frames in a single chunk', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    const fn = vi.fn();
    parser.on('data', fn);
    parser.write(Buffer.from([0x82, 0x02, 0xaa, 0xbb, 0x82, 0x01, 0xcc]));
    expect(fn.mock.calls.length).toBe(2);
    expect(fn.mock.calls[0][0]).toEqual(Buffer.from([0xaa, 0xbb]));
    expect(fn.mock.calls[1][0]).toEqual(Buffer.from([0xcc]));
  });

  it('buffers incomplete frames across writes', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    const fn = vi.fn();
    parser.on('data', fn);
    parser.write(Buffer.from([0x82, 0x03, 0xaa]));
    expect(fn.mock.calls.length).toBe(0);
    parser.write(Buffer.from([0xbb, 0xcc]));
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0][0]).toEqual(Buffer.from([0xaa, 0xbb, 0xcc]));
  });

  // ─── Phase 2: Framing validation ─────────────────────────────

  it('tracks bytes dropped before the first magic byte', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    const dataFn = vi.fn();
    const dropFn = vi.fn();
    parser.on('data', dataFn);
    parser.on('drop', dropFn);
    parser.write(Buffer.from([0x00, 0x01, 0x02, 0x82, 0x01, 0xff]));
    expect(dataFn.mock.calls.length).toBe(1);
    expect(dataFn.mock.calls[0][0]).toEqual(Buffer.from([0xff]));
    expect(dropFn.mock.calls.length).toBe(1);
    expect(dropFn.mock.calls[0][0]).toEqual(Buffer.from([0x00, 0x01, 0x02]));
    expect(parser.stats.bytesDropped).toBe(3);
  });

  it('tracks bytes dropped between frames', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    const dropFn = vi.fn();
    parser.on('drop', dropFn);
    parser.write(Buffer.from([0x82, 0x01, 0xaa, 0xff, 0xfe, 0x82, 0x01, 0xbb]));
    expect(parser.stats.framesEmitted).toBe(2);
    expect(parser.stats.bytesDropped).toBe(2);
    expect(dropFn.mock.calls.length).toBe(1);
    expect(dropFn.mock.calls[0][0]).toEqual(Buffer.from([0xff, 0xfe]));
  });

  it('stats start at zero', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    expect(parser.stats).toEqual({ framesEmitted: 0, bytesDropped: 0, incompleteFlushes: 0 });
  });

  it('stats accumulate correctly across multiple writes', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    parser.on('data', () => {});
    parser.on('drop', () => {});
    parser.write(Buffer.from([0x00, 0x01, 0x82, 0x01, 0xaa]));
    parser.write(Buffer.from([0x82, 0x02, 0xbb, 0xcc]));
    parser.write(Buffer.from([0xdd, 0x82, 0x05, 0x01]));
    expect(parser.stats.framesEmitted).toBe(2);
    expect(parser.stats.bytesDropped).toBe(3);
    parser.end();
    expect(parser.stats.bytesDropped).toBe(6);
    expect(parser.stats.incompleteFlushes).toBe(1);
  });

  it('emits stats snapshot (not a reference)', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    const snap1 = parser.stats;
    parser.on('data', () => {});
    parser.write(Buffer.from([0x82, 0x01, 0xaa]));
    const snap2 = parser.stats;
    expect(snap1.framesEmitted).toBe(0);
    expect(snap2.framesEmitted).toBe(1);
  });

  it('emits no drop events when data is clean', () => {
    const parser = new MagicByteLengthParser({ magicByte: 0x82 });
    const dropFn = vi.fn();
    parser.on('data', () => {});
    parser.on('drop', dropFn);
    parser.write(Buffer.from([0x82, 0x01, 0xaa, 0x82, 0x02, 0xbb, 0xcc]));
    parser.end();
    expect(dropFn.mock.calls.length).toBe(0);
    expect(parser.stats.bytesDropped).toBe(0);
    expect(parser.stats.incompleteFlushes).toBe(0);
  });
});
