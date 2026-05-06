import { describe, it, expect } from 'vitest';
import { rgba2rgb565 } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/util';

describe('rgba2rgb565', () => {
  it('converts pure red', () => {
    const rgba = new Uint8Array([255, 0, 0, 255]);
    const result = rgba2rgb565(rgba, 1);
    expect(result.length).toBe(2);
    expect(result.readUInt16LE(0)).toBe(0xf800);
  });

  it('converts pure green', () => {
    const rgba = new Uint8Array([0, 255, 0, 255]);
    const result = rgba2rgb565(rgba, 1);
    expect(result.readUInt16LE(0)).toBe(0x07e0);
  });

  it('converts pure blue', () => {
    const rgba = new Uint8Array([0, 0, 255, 255]);
    const result = rgba2rgb565(rgba, 1);
    expect(result.readUInt16LE(0)).toBe(0x001f);
  });

  it('converts white', () => {
    const rgba = new Uint8Array([255, 255, 255, 255]);
    const result = rgba2rgb565(rgba, 1);
    expect(result.readUInt16LE(0)).toBe(0xffff);
  });

  it('converts black', () => {
    const rgba = new Uint8Array([0, 0, 0, 255]);
    const result = rgba2rgb565(rgba, 1);
    expect(result.readUInt16LE(0)).toBe(0x0000);
  });

  it('converts multiple pixels', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const result = rgba2rgb565(rgba, 2);
    expect(result.length).toBe(4);
    expect(result.readUInt16LE(0)).toBe(0xf800);
    expect(result.readUInt16LE(2)).toBe(0x001f);
  });

  it('ignores the alpha channel', () => {
    const rgba = new Uint8Array([255, 0, 0, 128]);
    const result = rgba2rgb565(rgba, 1);
    expect(result.readUInt16LE(0)).toBe(0xf800);
  });
});
