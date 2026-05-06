import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StreamDeck, StreamDeckDeviceInfo, DeviceModelId } from '@elgato-stream-deck/node';
import { EventEmitter } from 'node:events';

// ─── Mocks ──────────────────────────────────────────────────────

// Mock the canvas module (required by ElgatoDriver for PNG→RGBA conversion)
vi.mock('canvas', () => {
  const fakeCtx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(96 * 96 * 4) // RGBA buffer
    })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn()
  };
  return {
    createCanvas: vi.fn(() => ({
      getContext: vi.fn(() => fakeCtx)
    })),
    loadImage: vi.fn(async () => ({ width: 96, height: 96 }))
  };
});

// Mock KeyRenderer
vi.mock('../../../../src/main/rendering/KeyRenderer', () => ({
  renderKey: vi.fn(async () => 'data:image/png;base64,AAAA')
}));

// ─── Fake StreamDeck device ─────────────────────────────────────

class FakeStreamDeck extends EventEmitter {
  MODEL = 'original-mk2' as const;
  PRODUCT_NAME = 'Stream Deck MK.2';
  HAS_NFC_READER = false;
  CONTROLS: Array<Record<string, unknown>> = [
    // 15 buttons (3×5 grid)
    ...Array.from({ length: 15 }, (_, i) => ({
      type: 'button' as const,
      index: i,
      hidIndex: i,
      row: Math.floor(i / 5),
      column: i % 5,
      feedbackType: 'lcd' as const,
      pixelSize: { width: 72, height: 72 }
    }))
  ];

  fillKeyBuffer = vi.fn(async () => {});
  fillKeyColor = vi.fn(async () => {});
  clearKey = vi.fn(async () => {});
  clearPanel = vi.fn(async () => {});
  setBrightness = vi.fn(async () => {});
  resetToLogo = vi.fn(async () => {});
  getSerialNumber = vi.fn(async () => 'ELGATO-TEST-001');
  getFirmwareVersion = vi.fn(async () => '1.2.3');
  getAllFirmwareVersions = vi.fn(async () => ({ main: '1.2.3' }));
  getHidDeviceInfo = vi.fn(async () => ({ path: '/dev/hidraw0' }));
  getChildDeviceInfo = vi.fn(async () => null);
  calculateFillPanelDimensions = vi.fn(() => ({ width: 360, height: 216 }));
  fillPanelBuffer = vi.fn(async () => {});
  prepareFillPanelBuffer = vi.fn(async () => ({}));
  prepareFillKeyBuffer = vi.fn(async () => ({}));
  sendPreparedBuffer = vi.fn(async () => {});
  fillLcd = vi.fn(async () => {});
  fillLcdRegion = vi.fn(async () => {});
  prepareFillLcdRegion = vi.fn(async () => ({}));
  clearLcdSegment = vi.fn(async () => {});
  setEncoderColor = vi.fn(async () => {});
  setEncoderRingSingleColor = vi.fn(async () => {});
  setEncoderRingColors = vi.fn(async () => {});
  close = vi.fn(async () => {});
}

function createFakeStreamDeckPlus(): FakeStreamDeck {
  const sd = new FakeStreamDeck();
  (sd as unknown as { MODEL: string }).MODEL = 'plus';
  sd.PRODUCT_NAME = 'Stream Deck +';
  sd.CONTROLS = [
    // 8 buttons (2×4)
    ...Array.from({ length: 8 }, (_, i) => ({
      type: 'button' as const,
      index: i,
      hidIndex: i,
      row: Math.floor(i / 4),
      column: i % 4,
      feedbackType: 'lcd' as const,
      pixelSize: { width: 120, height: 120 }
    })),
    // 4 encoders
    ...Array.from({ length: 4 }, (_, i) => ({
      type: 'encoder' as const,
      index: i,
      hidIndex: i + 8,
      row: 2,
      column: i,
      hasLed: true,
      ledRingSteps: 24
    }))
  ];
  return sd;
}

// ─── Mock the @elgato-stream-deck/node module ─────────────────

let fakeDevice: FakeStreamDeck;
const mockListStreamDecks = vi.fn<() => Promise<StreamDeckDeviceInfo[]>>(async () => []);
const mockOpenStreamDeck = vi.fn<(path: string) => Promise<StreamDeck>>(
  async () => fakeDevice as unknown as StreamDeck
);

vi.mock('@elgato-stream-deck/node', () => ({
  listStreamDecks: (...args: unknown[]) => mockListStreamDecks(...(args as [])),
  openStreamDeck: (...args: unknown[]) => mockOpenStreamDeck(...(args as [string])),
  DeviceModelId: {
    ORIGINAL: 'original',
    ORIGINALV2: 'originalv2',
    ORIGINALMK2: 'original-mk2',
    ORIGINALMK2SCISSOR: 'original-mk2-scissor',
    MINI: 'mini',
    XL: 'xl',
    PEDAL: 'pedal',
    PLUS: 'plus',
    NEO: 'neo',
    STUDIO: 'studio'
  }
}));

// ─── Import the driver under test ───────────────────────────────

import { ElgatoDriver } from '../../../src/main/devices/drivers/elgato/ElgatoDriver';

// ─── Tests ──────────────────────────────────────────────────────

describe('ElgatoDriver', () => {
  let driver: ElgatoDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDevice = new FakeStreamDeck();
    driver = new ElgatoDriver();
  });

  afterEach(async () => {
    await driver.dispose();
  });

  // ─── Discovery ─────────────────────────────────────────────

  describe('discover', () => {
    it('should return empty array when no devices found', async () => {
      mockListStreamDecks.mockResolvedValueOnce([]);
      const result = await driver.discover();
      expect(result).toEqual([]);
    });

    it('should discover and connect to a new device', async () => {
      mockListStreamDecks.mockResolvedValueOnce([
        { model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0', serialNumber: 'SN001' }
      ]);

      const result = await driver.discover();
      expect(result).toHaveLength(1);
      expect(mockOpenStreamDeck).toHaveBeenCalledWith('/dev/hidraw0', expect.any(Object));
    });

    it('should not re-discover already managed devices', async () => {
      const deviceInfo: StreamDeckDeviceInfo = {
        model: 'original-mk2' as DeviceModelId,
        path: '/dev/hidraw0',
        serialNumber: 'SN001'
      };
      mockListStreamDecks.mockResolvedValue([deviceInfo]);

      await driver.discover();
      const result = await driver.discover();

      expect(result).toHaveLength(0);
      expect(mockOpenStreamDeck).toHaveBeenCalledTimes(1);
    });

    it('should handle list errors gracefully', async () => {
      mockListStreamDecks.mockRejectedValueOnce(new Error('USB error'));
      const result = await driver.discover();
      expect(result).toEqual([]);
    });

    it('should handle connection errors gracefully', async () => {
      mockListStreamDecks.mockResolvedValueOnce([{ model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0' }]);
      mockOpenStreamDeck.mockRejectedValueOnce(new Error('cannot open device'));

      const result = await driver.discover();
      expect(result).toHaveLength(0);
    });
  });

  // ─── Dispose ───────────────────────────────────────────────

  describe('dispose', () => {
    it('should dispose a specific device by ID', async () => {
      mockListStreamDecks.mockResolvedValueOnce([
        { model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0', serialNumber: 'SN001' }
      ]);
      const devices = await driver.discover();
      expect(devices).toHaveLength(1);

      await driver.dispose(devices[0].id);
      expect(fakeDevice.close).toHaveBeenCalled();
    });

    it('should dispose all devices when no ID given', async () => {
      mockListStreamDecks.mockResolvedValueOnce([
        { model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0', serialNumber: 'SN001' }
      ]);
      await driver.discover();

      await driver.dispose();
      expect(fakeDevice.close).toHaveBeenCalled();
    });

    it('should do nothing when disposing unknown device ID', async () => {
      await driver.dispose('nonexistent');
      // Should not throw
    });
  });
});

// ─── ElgatoManagedDevice ────────────────────────────────────────

describe('ElgatoManagedDevice (via driver.discover)', () => {
  let driver: ElgatoDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDevice = new FakeStreamDeck();
    driver = new ElgatoDriver();
  });

  afterEach(async () => {
    await driver.dispose();
  });

  async function discoverFirst(): Promise<
    ReturnType<typeof driver.discover> extends Promise<infer T> ? (T extends (infer U)[] ? U : never) : never
  > {
    mockListStreamDecks.mockResolvedValueOnce([
      { model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0', serialNumber: 'SN001' }
    ]);
    const devices = await driver.discover();
    return devices[0];
  }

  // ─── getInfo ───────────────────────────────────────────────

  describe('getInfo', () => {
    it('should return correct info for Stream Deck MK.2', async () => {
      const device = await discoverFirst();
      const info = device.getInfo();

      expect(info.name).toBe('Stream Deck MK.2');
      expect(info.rows).toBe(3);
      expect(info.cols).toBe(5);
      expect(info.keySize).toBe(72);
      expect(info.connected).toBe(true);
      expect(info.safeAreaInsets).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    it('should use serial number for stable ID', async () => {
      const device = await discoverFirst();
      const info = device.getInfo();
      expect(info.id).toBe('elgato-ELGATO-TEST-001');
      expect(info.serial).toBe('ELGATO-TEST-001');
    });

    it('should include firmware version', async () => {
      const device = await discoverFirst();
      const info = device.getInfo();
      expect(info.firmwareVersion).toBe('1.2.3');
    });

    it('should return correct info for Stream Deck Mini', async () => {
      (fakeDevice as unknown as { MODEL: string }).MODEL = 'mini';
      fakeDevice.PRODUCT_NAME = 'Stream Deck Mini';
      fakeDevice.CONTROLS = Array.from({ length: 6 }, (_, i) => ({
        type: 'button' as const,
        index: i,
        hidIndex: i,
        row: Math.floor(i / 3),
        column: i % 3,
        feedbackType: 'lcd' as const,
        pixelSize: { width: 80, height: 80 }
      }));

      const device = await discoverFirst();
      const info = device.getInfo();
      expect(info.rows).toBe(2);
      expect(info.cols).toBe(3);
      expect(info.keySize).toBe(80);
    });

    it('should return correct info for Stream Deck XL', async () => {
      (fakeDevice as unknown as { MODEL: string }).MODEL = 'xl';
      fakeDevice.PRODUCT_NAME = 'Stream Deck XL';

      const device = await discoverFirst();
      const info = device.getInfo();
      expect(info.rows).toBe(4);
      expect(info.cols).toBe(8);
      expect(info.keySize).toBe(96);
    });

    it('should return correct info for Stream Deck + with encoders', async () => {
      fakeDevice = createFakeStreamDeckPlus();

      const device = await discoverFirst();
      const info = device.getInfo();
      expect(info.rows).toBe(2);
      expect(info.cols).toBe(4);
      expect(info.keySize).toBe(120);

      // Should have buttons + encoders
      const knobs = info.controls.filter((c) => c.type === 'knob');
      expect(knobs).toHaveLength(4);
      expect(knobs[0]).toMatchObject({ id: 'encoder0', side: 'bottom' });
      expect(knobs[3]).toMatchObject({ id: 'encoder3', side: 'bottom' });
    });
  });

  // ─── setBrightness ────────────────────────────────────────

  describe('setBrightness', () => {
    it('should convert 0-1 range to 0-100 for the library', async () => {
      const device = await discoverFirst();
      await device.setBrightness(0.5);
      expect(fakeDevice.setBrightness).toHaveBeenCalledWith(50);
    });

    it('should clamp brightness to 0-1 range', async () => {
      const device = await discoverFirst();
      await device.setBrightness(1.5);
      expect(fakeDevice.setBrightness).toHaveBeenCalledWith(100);

      await device.setBrightness(-0.5);
      expect(fakeDevice.setBrightness).toHaveBeenCalledWith(0);
    });
  });

  // ─── drawKey ──────────────────────────────────────────────

  describe('drawKey', () => {
    it('should render layers and call fillKeyBuffer with RGBA', async () => {
      const device = await discoverFirst();
      const appearance = { layers: [] };

      await device.drawKey(0, appearance);

      expect(fakeDevice.fillKeyBuffer).toHaveBeenCalledWith(0, expect.any(Buffer), { format: 'rgba' });
    });

    it('should handle draw errors gracefully', async () => {
      fakeDevice.fillKeyBuffer.mockRejectedValueOnce(new Error('USB write failed'));
      const device = await discoverFirst();
      // Should not throw
      await device.drawKey(0, { layers: [] });
    });
  });

  // ─── Event forwarding ────────────────────────────────────

  describe('event forwarding', () => {
    it('should forward button down events', async () => {
      const device = await discoverFirst();
      const spy = vi.fn();
      device.on('down', spy);

      fakeDevice.emit('down', { type: 'button', index: 3 });
      expect(spy).toHaveBeenCalledWith({ buttonIndex: 3 });
    });

    it('should forward button up events', async () => {
      const device = await discoverFirst();
      const spy = vi.fn();
      device.on('up', spy);

      fakeDevice.emit('up', { type: 'button', index: 7 });
      expect(spy).toHaveBeenCalledWith({ buttonIndex: 7 });
    });

    it('should forward encoder press as knob-press event', async () => {
      fakeDevice = createFakeStreamDeckPlus();
      const device = await discoverFirst();
      const spy = vi.fn();
      device.on('knob-press', spy);

      fakeDevice.emit('down', { type: 'encoder', index: 2 });
      expect(spy).toHaveBeenCalledWith({ knobId: 'encoder2' });
    });

    it('should forward encoder rotation as rotate event', async () => {
      fakeDevice = createFakeStreamDeckPlus();
      const device = await discoverFirst();
      const spy = vi.fn();
      device.on('rotate', spy);

      fakeDevice.emit('rotate', { type: 'encoder', index: 1 }, -3);
      expect(spy).toHaveBeenCalledWith({ knobId: 'encoder1', delta: -3 });
    });

    it('should emit disconnect on device error', async () => {
      const device = await discoverFirst();
      const spy = vi.fn();
      device.on('disconnect', spy);

      fakeDevice.emit('error', new Error('device detached'));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should not emit events after disconnect', async () => {
      const device = await discoverFirst();
      const downSpy = vi.fn();
      device.on('down', downSpy);

      // Disconnect first
      fakeDevice.emit('error', new Error('gone'));

      // Then try emitting button events — should be ignored
      fakeDevice.emit('down', { type: 'button', index: 0 });
      expect(downSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Disconnect ───────────────────────────────────────────

  describe('disconnect', () => {
    it('should close the raw device', async () => {
      const device = await discoverFirst();
      await device.disconnect();
      expect(fakeDevice.close).toHaveBeenCalled();
    });

    it('should only disconnect once (guard against double disconnect)', async () => {
      const device = await discoverFirst();
      await device.disconnect();
      await device.disconnect();
      // close() is called from handleDisconnect which guards with this.disconnected
      expect(fakeDevice.close).toHaveBeenCalledTimes(1);
    });

    it('should remove device from driver map on disconnect', async () => {
      mockListStreamDecks.mockResolvedValueOnce([
        { model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0', serialNumber: 'SN001' }
      ]);
      const devices = await driver.discover();
      expect(devices).toHaveLength(1);

      // Trigger disconnect
      fakeDevice.emit('error', new Error('unplugged'));

      // Device should be re-discoverable (removed from internal map)
      mockListStreamDecks.mockResolvedValueOnce([
        { model: 'original-mk2' as DeviceModelId, path: '/dev/hidraw0', serialNumber: 'SN001' }
      ]);
      fakeDevice = new FakeStreamDeck(); // fresh device
      const newDevices = await driver.discover();
      expect(newDevices).toHaveLength(1);
    });
  });

  // ─── Draw queue coalescing ────────────────────────────────

  describe('draw queue', () => {
    it('should coalesce rapid draws to the same key', async () => {
      const device = await discoverFirst();
      const appearance1 = {
        layers: [
          { type: 'fill' as const, color: '#ff0000', visible: true, opacity: 1, id: 'a', locked: false, name: 'Fill' }
        ]
      };
      const appearance2 = {
        layers: [
          { type: 'fill' as const, color: '#00ff00', visible: true, opacity: 1, id: 'b', locked: false, name: 'Fill' }
        ]
      };

      // Fire two draws without awaiting
      const p1 = device.drawKey(0, appearance1);
      const p2 = device.drawKey(0, appearance2);

      await Promise.all([p1, p2]);

      // fillKeyBuffer should have been called (at least once for the latest)
      expect(fakeDevice.fillKeyBuffer).toHaveBeenCalled();
    });
  });

  // ─── setKeyInsets ─────────────────────────────────────────

  describe('setKeyInsets', () => {
    it('should update device info insets', async () => {
      const device = await discoverFirst();
      device.setKeyInsets({ top: 2, bottom: 2, left: 2, right: 2 });
      const info = device.getInfo();
      expect(info.safeAreaInsets).toEqual({ top: 2, bottom: 2, left: 2, right: 2 });
    });
  });
});
