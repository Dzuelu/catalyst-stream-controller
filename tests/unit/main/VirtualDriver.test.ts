import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setFile, resetMockFs, getFile } from '../../mocks/fs';

// Mock KeyRenderer (used by VirtualManagedDevice.drawKey)
vi.mock('../../../src/main/rendering/KeyRenderer', () => ({
  renderKey: vi.fn(async () => 'data:image/png;base64,TEST_KEY_IMAGE')
}));

import {
  type VirtualDeviceConfig,
  validateVirtualDeviceConfig,
  createDefaultVirtualDeviceConfig,
  generateVirtualDeviceId,
  buildVirtualEncoders,
  buildVirtualSliders
} from '../../../src/main/devices/virtual/VirtualDeviceConfig';
import { createDefaultAppearance } from '../../../src/shared/types';
import { VirtualDriver } from '../../../src/main/devices/virtual/VirtualDriver';
import { VirtualManagedDevice } from '../../../src/main/devices/virtual/VirtualManagedDevice';

/** Path used by VirtualDriver when given explicit dataPath */
const TEST_DATA_PATH = '/mock/userData/virtual-devices.json';

/** Create a valid config for testing */
function makeConfig(overrides: Partial<VirtualDeviceConfig> = {}): VirtualDeviceConfig {
  return {
    id: 'virtual-test-001',
    name: 'Test Deck',
    rows: 3,
    columns: 5,
    keySize: 96,
    encoders: 0,
    encoderPosition: 'none',
    sliders: 0,
    sliderPosition: 'none',
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════════════
//  VirtualDeviceConfig utilities
// ═══════════════════════════════════════════════════════════════════

describe('VirtualDeviceConfig', () => {
  describe('generateVirtualDeviceId', () => {
    it('should return a string starting with "virtual-"', () => {
      const id = generateVirtualDeviceId();
      expect(id).toMatch(/^virtual-/);
    });

    it('should return unique IDs', () => {
      const ids = new Set(Array.from({ length: 50 }, () => generateVirtualDeviceId()));
      expect(ids.size).toBe(50);
    });
  });

  describe('validateVirtualDeviceConfig', () => {
    it('should return null for a valid config', () => {
      expect(validateVirtualDeviceConfig(makeConfig())).toBeNull();
    });

    it('should reject empty id', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ id: '' }))).toContain('ID');
    });

    it('should reject empty name', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ name: '' }))).toContain('name');
    });

    it('should reject whitespace-only name', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ name: '   ' }))).toContain('name');
    });

    it('should reject rows < 1', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ rows: 0 }))).toContain('Rows');
    });

    it('should reject rows > 8', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ rows: 9 }))).toContain('Rows');
    });

    it('should reject columns < 1', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ columns: 0 }))).toContain('Columns');
    });

    it('should reject columns > 12', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ columns: 13 }))).toContain('Columns');
    });

    it('should reject keySize < 32', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ keySize: 31 }))).toContain('Key size');
    });

    it('should reject keySize > 256', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ keySize: 257 }))).toContain('Key size');
    });

    it('should reject encoders < 0', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ encoders: -1 }))).toContain('Encoders');
    });

    it('should reject encoders > 6', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ encoders: 7 }))).toContain('Encoders');
    });

    it('should reject sliders < 0', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ sliders: -1 }))).toContain('Sliders');
    });

    it('should reject sliders > 8', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ sliders: 9 }))).toContain('Sliders');
    });

    it('should reject invalid encoder position', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ encoderPosition: 'top' as 'left' }))).toContain(
        'encoder position'
      );
    });

    it('should reject invalid slider position', () => {
      expect(validateVirtualDeviceConfig(makeConfig({ sliderPosition: 'center' as 'left' }))).toContain(
        'slider position'
      );
    });

    it('should accept boundary values (min)', () => {
      expect(
        validateVirtualDeviceConfig(makeConfig({ rows: 1, columns: 1, keySize: 32, encoders: 0, sliders: 0 }))
      ).toBeNull();
    });

    it('should accept boundary values (max)', () => {
      expect(
        validateVirtualDeviceConfig(makeConfig({ rows: 8, columns: 12, keySize: 256, encoders: 6, sliders: 8 }))
      ).toBeNull();
    });
  });

  describe('createDefaultVirtualDeviceConfig', () => {
    it('should create a valid config with default name', () => {
      const config = createDefaultVirtualDeviceConfig();
      expect(validateVirtualDeviceConfig(config)).toBeNull();
      expect(config.name).toBe('Virtual Deck');
      expect(config.rows).toBe(3);
      expect(config.columns).toBe(5);
      expect(config.keySize).toBe(96);
    });

    it('should use a custom name when provided', () => {
      const config = createDefaultVirtualDeviceConfig('My Deck');
      expect(config.name).toBe('My Deck');
    });

    it('should generate a unique ID', () => {
      const a = createDefaultVirtualDeviceConfig();
      const b = createDefaultVirtualDeviceConfig();
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('buildVirtualEncoders', () => {
    it('should return empty array when encoders=0', () => {
      expect(buildVirtualEncoders(makeConfig({ encoders: 0 }))).toEqual([]);
    });

    it('should return correct number of knob controls', () => {
      const knobs = buildVirtualEncoders(makeConfig({ encoders: 3, encoderPosition: 'bottom' }));
      expect(knobs).toHaveLength(3);
      knobs.forEach((k, i) => {
        expect(k.type).toBe('knob');
        expect(k.id).toBe(`encoder${i}`);
        expect(k.label).toBe(`Encoder ${i + 1}`);
        expect(k.side).toBe('bottom');
      });
    });

    it('should default to bottom side when position is none', () => {
      const knobs = buildVirtualEncoders(makeConfig({ encoders: 1, encoderPosition: 'none' }));
      expect(knobs[0].side).toBe('bottom');
    });
  });

  describe('buildVirtualSliders', () => {
    it('should return empty array when sliders=0', () => {
      expect(buildVirtualSliders(makeConfig({ sliders: 0 }))).toEqual([]);
    });

    it('should return correct number of slider controls', () => {
      const sliders = buildVirtualSliders(makeConfig({ sliders: 2, sliderPosition: 'left' }));
      expect(sliders).toHaveLength(2);
      sliders.forEach((s, i) => {
        expect(s.type).toBe('slider');
        expect(s.id).toBe(`slider${i}`);
        expect(s.label).toBe(`Slider ${i + 1}`);
        expect(s.side).toBe('left');
      });
    });

    it('should default to right side when position is bottom or none', () => {
      const sliders = buildVirtualSliders(makeConfig({ sliders: 1, sliderPosition: 'bottom' }));
      expect(sliders[0].side).toBe('right');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  VirtualManagedDevice
// ═══════════════════════════════════════════════════════════════════

describe('VirtualManagedDevice', () => {
  let device: VirtualManagedDevice;

  beforeEach(() => {
    const config = makeConfig({ encoders: 2, encoderPosition: 'bottom', sliders: 1, sliderPosition: 'right' });
    const knobs = buildVirtualEncoders(config);
    const sliders = buildVirtualSliders(config);
    device = new VirtualManagedDevice(config, knobs, sliders);
  });

  describe('getInfo', () => {
    it('should return correct device info', () => {
      const info = device.getInfo();
      expect(info.id).toBe('virtual-test-001');
      expect(info.name).toBe('Test Deck');
      expect(info.rows).toBe(3);
      expect(info.cols).toBe(5);
      expect(info.keySize).toBe(96);
      expect(info.connected).toBe(true);
    });

    it('should include button, knob, and slider controls', () => {
      const { controls } = device.getInfo();
      const buttons = controls.filter((c) => c.type === 'button');
      const knobs = controls.filter((c) => c.type === 'knob');
      const sliders = controls.filter((c) => c.type === 'slider');
      expect(buttons).toHaveLength(15); // 3×5
      expect(knobs).toHaveLength(2);
      expect(sliders).toHaveLength(1);
    });

    it('should return a copy (not the internal reference)', () => {
      const a = device.getInfo();
      const b = device.getInfo();
      expect(a).not.toBe(b);
    });
  });

  describe('interaction injection', () => {
    it('should emit "down" on injectKeyDown', () => {
      const spy = vi.fn();
      device.on('down', spy);
      device.injectKeyDown(5);
      expect(spy).toHaveBeenCalledWith({ buttonIndex: 5 });
    });

    it('should emit "up" on injectKeyUp', () => {
      const spy = vi.fn();
      device.on('up', spy);
      device.injectKeyUp(7);
      expect(spy).toHaveBeenCalledWith({ buttonIndex: 7 });
    });

    it('should emit "rotate" on injectEncoderRotate', () => {
      const spy = vi.fn();
      device.on('rotate', spy);
      device.injectEncoderRotate('encoder0', 3);
      expect(spy).toHaveBeenCalledWith({ knobId: 'encoder0', delta: 3 });
    });

    it('should emit "knob-press" on injectEncoderPress', () => {
      const spy = vi.fn();
      device.on('knob-press', spy);
      device.injectEncoderPress('encoder1');
      expect(spy).toHaveBeenCalledWith({ knobId: 'encoder1' });
    });

    it('should emit "slider-change" on injectSliderChange', () => {
      const spy = vi.fn();
      device.on('slider-change', spy);
      device.injectSliderChange('slider0', 64);
      expect(spy).toHaveBeenCalledWith({ sliderId: 'slider0', value: 64 });
    });

    it('should clamp slider values to 0–127', () => {
      const spy = vi.fn();
      device.on('slider-change', spy);
      device.injectSliderChange('slider0', -10);
      expect(spy).toHaveBeenCalledWith({ sliderId: 'slider0', value: 0 });
      device.injectSliderChange('slider0', 200);
      expect(spy).toHaveBeenCalledWith({ sliderId: 'slider0', value: 127 });
    });

    it('should not emit events after disconnect', async () => {
      const spy = vi.fn();
      device.on('down', spy);
      await device.disconnect();
      device.injectKeyDown(0);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('state queries', () => {
    it('should track slider values', () => {
      expect(device.getSliderValue('slider0')).toBe(0);
      device.injectSliderChange('slider0', 100);
      expect(device.getSliderValue('slider0')).toBe(100);
    });

    it('should return 0 for unknown slider', () => {
      expect(device.getSliderValue('nonexistent')).toBe(0);
    });

    it('should return all slider values', () => {
      device.injectSliderChange('slider0', 42);
      const values = device.getAllSliderValues();
      expect(values).toEqual({ slider0: 42 });
    });

    it('should return empty key images initially', () => {
      expect(device.getAllKeyImages().size).toBe(0);
    });
  });

  describe('drawKey', () => {
    it('should render and cache a key image', async () => {
      const spy = vi.fn();
      device.on('key-image', spy);
      await device.drawKey(0, createDefaultAppearance());
      expect(device.getKeyImage(0)).toBe('data:image/png;base64,TEST_KEY_IMAGE');
      expect(spy).toHaveBeenCalledWith({
        keyIndex: 0,
        dataUri: 'data:image/png;base64,TEST_KEY_IMAGE'
      });
    });

    it('should not render after disconnect', async () => {
      await device.disconnect();
      await device.drawKey(0, createDefaultAppearance());
      expect(device.getKeyImage(0)).toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('should emit disconnect event', async () => {
      const spy = vi.fn();
      device.on('disconnect', spy);
      await device.disconnect();
      expect(spy).toHaveBeenCalled();
    });

    it('should mark device as disconnected', async () => {
      await device.disconnect();
      expect(device.getInfo().connected).toBe(false);
    });

    it('should clear key images', async () => {
      await device.drawKey(0, createDefaultAppearance());
      expect(device.getKeyImage(0)).toBeDefined();
      await device.disconnect();
      expect(device.getKeyImage(0)).toBeUndefined();
    });

    it('should be idempotent', async () => {
      const spy = vi.fn();
      device.on('disconnect', spy);
      await device.disconnect();
      await device.disconnect();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setKeyInsets', () => {
    it('should update safe area insets', () => {
      device.setKeyInsets({ top: 5, bottom: 5, left: 3, right: 3 });
      const info = device.getInfo();
      expect(info.safeAreaInsets).toEqual({ top: 5, bottom: 5, left: 3, right: 3 });
    });
  });

  describe('metadata', () => {
    it('should expose config', () => {
      expect(device.getConfig()).toEqual(expect.objectContaining({ id: 'virtual-test-001', name: 'Test Deck' }));
    });

    it('should be marked as virtual', () => {
      expect(device.isVirtual).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  VirtualDriver
// ═══════════════════════════════════════════════════════════════════

describe('VirtualDriver', () => {
  let driver: VirtualDriver;

  beforeEach(() => {
    resetMockFs();
    driver = new VirtualDriver(TEST_DATA_PATH);
  });

  afterEach(async () => {
    await driver.dispose();
  });

  describe('name', () => {
    it('should be "Virtual"', () => {
      expect(driver.name).toBe('Virtual');
    });
  });

  describe('load', () => {
    it('should load with no file (fresh start)', async () => {
      await driver.load();
      expect(driver.getConfigs()).toEqual([]);
    });

    it('should load saved configs from disk', async () => {
      const config = makeConfig();
      setFile(TEST_DATA_PATH, JSON.stringify({ devices: [config] }));

      await driver.load();
      expect(driver.getConfigs()).toHaveLength(1);
      expect(driver.getConfig('virtual-test-001')).toEqual(config);
    });

    it('should skip invalid configs', async () => {
      const bad = makeConfig({ rows: 999 });
      const good = makeConfig({ id: 'virtual-good', rows: 2 });
      setFile(TEST_DATA_PATH, JSON.stringify({ devices: [bad, good] }));

      await driver.load();
      expect(driver.getConfigs()).toHaveLength(1);
      expect(driver.getConfig('virtual-good')).toBeDefined();
    });
  });

  describe('createDevice', () => {
    it('should create a device and persist it', async () => {
      await driver.load();
      const config = makeConfig();
      const device = await driver.createDevice(config);

      expect(device.id).toBe('virtual-test-001');
      expect(driver.getConfigs()).toHaveLength(1);

      // Check persistence
      const saved = JSON.parse(getFile(TEST_DATA_PATH)!);
      expect(saved.devices).toHaveLength(1);
      expect(saved.devices[0].id).toBe('virtual-test-001');
    });

    it('should throw on invalid config', async () => {
      await driver.load();
      await expect(driver.createDevice(makeConfig({ rows: 0 }))).rejects.toThrow('Invalid');
    });

    it('should throw on duplicate ID', async () => {
      await driver.load();
      await driver.createDevice(makeConfig());
      await expect(driver.createDevice(makeConfig())).rejects.toThrow('already exists');
    });

    it('should return a functional ManagedDevice', async () => {
      await driver.load();
      const device = await driver.createDevice(makeConfig({ encoders: 1, encoderPosition: 'bottom' }));
      const info = device.getInfo();
      expect(info.controls.filter((c) => c.type === 'knob')).toHaveLength(1);

      const spy = vi.fn();
      device.on('down', spy);
      device.injectKeyDown(3);
      expect(spy).toHaveBeenCalledWith({ buttonIndex: 3 });
    });
  });

  describe('updateDevice', () => {
    it('should update config, disconnect old device, and return new one', async () => {
      await driver.load();
      const old = await driver.createDevice(makeConfig());
      const disconnectSpy = vi.fn();
      old.on('disconnect', disconnectSpy);

      const updated = await driver.updateDevice(makeConfig({ name: 'Updated Deck', rows: 4 }));

      expect(disconnectSpy).toHaveBeenCalled();
      expect(updated.getInfo().name).toBe('Updated Deck');
      expect(updated.getInfo().rows).toBe(4);

      // Persistence
      const saved = JSON.parse(getFile(TEST_DATA_PATH)!);
      expect(saved.devices[0].name).toBe('Updated Deck');
    });

    it('should throw for nonexistent device', async () => {
      await driver.load();
      await expect(driver.updateDevice(makeConfig({ id: 'nope' }))).rejects.toThrow('not found');
    });
  });

  describe('deleteDevice', () => {
    it('should remove config and disconnect device', async () => {
      await driver.load();
      const device = await driver.createDevice(makeConfig());
      const disconnectSpy = vi.fn();
      device.on('disconnect', disconnectSpy);

      await driver.deleteDevice('virtual-test-001');

      expect(disconnectSpy).toHaveBeenCalled();
      expect(driver.getConfigs()).toHaveLength(0);
      expect(driver.getDevice('virtual-test-001')).toBeUndefined();

      // Persistence
      const saved = JSON.parse(getFile(TEST_DATA_PATH)!);
      expect(saved.devices).toHaveLength(0);
    });

    it('should not throw when deleting nonexistent device', async () => {
      await driver.load();
      await expect(driver.deleteDevice('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('discover', () => {
    it('should return devices for configs without active instances', async () => {
      setFile(TEST_DATA_PATH, JSON.stringify({ devices: [makeConfig()] }));
      await driver.load();

      const discovered = await driver.discover();
      expect(discovered).toHaveLength(1);
      expect(discovered[0].id).toBe('virtual-test-001');
    });

    it('should not return already-instantiated devices', async () => {
      setFile(TEST_DATA_PATH, JSON.stringify({ devices: [makeConfig()] }));
      await driver.load();

      const first = await driver.discover();
      expect(first).toHaveLength(1);

      const second = await driver.discover();
      expect(second).toHaveLength(0);
    });

    it('should auto-load if not yet loaded', async () => {
      setFile(TEST_DATA_PATH, JSON.stringify({ devices: [makeConfig()] }));
      // Note: NOT calling driver.load() first
      const discovered = await driver.discover();
      expect(discovered).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should disconnect all devices', async () => {
      await driver.load();
      const d1 = await driver.createDevice(makeConfig({ id: 'v1', name: 'A' }));
      const d2 = await driver.createDevice(makeConfig({ id: 'v2', name: 'B' }));

      const spy1 = vi.fn();
      const spy2 = vi.fn();
      d1.on('disconnect', spy1);
      d2.on('disconnect', spy2);

      await driver.dispose();

      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });

    it('should disconnect only specified device when deviceId given', async () => {
      await driver.load();
      const d1 = await driver.createDevice(makeConfig({ id: 'v1', name: 'A' }));
      const d2 = await driver.createDevice(makeConfig({ id: 'v2', name: 'B' }));

      const spy1 = vi.fn();
      const spy2 = vi.fn();
      d1.on('disconnect', spy1);
      d2.on('disconnect', spy2);

      await driver.dispose('v1');

      expect(spy1).toHaveBeenCalled();
      expect(spy2).not.toHaveBeenCalled();

      // v2 should still be accessible
      expect(driver.getDevice('v2')).toBeDefined();
    });
  });

  describe('getDevice / getConfig', () => {
    it('should return undefined for unknown IDs', async () => {
      await driver.load();
      expect(driver.getDevice('nope')).toBeUndefined();
      expect(driver.getConfig('nope')).toBeUndefined();
    });

    it('should return device after createDevice', async () => {
      await driver.load();
      await driver.createDevice(makeConfig());
      expect(driver.getDevice('virtual-test-001')).toBeDefined();
    });
  });

  describe('multiple devices', () => {
    it('should manage multiple virtual devices concurrently', async () => {
      await driver.load();

      const configs = Array.from({ length: 5 }, (_, i) =>
        makeConfig({
          id: `virtual-${i}`,
          name: `Deck ${i}`,
          rows: 2 + (i % 3),
          columns: 3 + (i % 4)
        })
      );

      for (const c of configs) {
        await driver.createDevice(c);
      }

      expect(driver.getConfigs()).toHaveLength(5);

      // Delete middle one
      await driver.deleteDevice('virtual-2');
      expect(driver.getConfigs()).toHaveLength(4);
      expect(driver.getDevice('virtual-2')).toBeUndefined();

      // Others still work
      const d0 = driver.getDevice('virtual-0')!;
      const spy = vi.fn();
      d0.on('down', spy);
      d0.injectKeyDown(0);
      expect(spy).toHaveBeenCalled();
    });
  });
});
