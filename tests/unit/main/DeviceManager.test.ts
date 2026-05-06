import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { DeviceDriver, ManagedDevice } from '../../../src/main/devices/types';
import type { DeviceInfo } from '../../../src/shared/types';

// We test DeviceManager by constructing it with mocked drivers.
// The real DeviceManager pushes LoupedeckDriver in the constructor,
// so we need to mock that import.
vi.mock('../../../src/main/devices/drivers/loupedeck/LoupedeckDriver', () => ({
  LoupedeckDriver: class {
    name = 'MockLoupedeck';
    discover = vi.fn(async () => []);
    dispose = vi.fn(async () => {});
  }
}));

vi.mock('../../../src/main/devices/drivers/elgato/ElgatoDriver', () => ({
  ElgatoDriver: class {
    name = 'MockElgato';
    discover = vi.fn(async () => []);
    dispose = vi.fn(async () => {});
  }
}));

import { DeviceManager } from '../../../src/main/devices/DeviceManager';

/** Create a mock ManagedDevice for testing */
function createMockManagedDevice(id = 'mock-device-001', name = 'Mock Device'): ManagedDevice & EventEmitter {
  const device = new EventEmitter() as ManagedDevice & EventEmitter;
  device.id = id;
  device.getInfo = vi.fn(
    (): DeviceInfo => ({
      id,
      name,
      serial: 'MOCK-SERIAL',
      firmwareVersion: '1.0.0',
      rows: 3,
      cols: 5,
      keySize: 96,
      controls: [],
      connected: true,
      safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  );
  device.setBrightness = vi.fn(async () => {});
  device.drawKey = vi.fn(async () => {});
  device.drawCalibration = vi.fn(async () => {});
  device.setKeyInsets = vi.fn();
  device.disconnect = vi.fn(async () => {
    device.emit('disconnect');
  });
  return device;
}

describe('DeviceManager', () => {
  let dm: DeviceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    dm = new DeviceManager();
  });

  afterEach(async () => {
    await dm.dispose();
    vi.useRealTimers();
  });

  // ─── Discovery ────────────────────────────────────────────

  describe('discover', () => {
    it('should call discover on all registered drivers', async () => {
      await dm.discover();

      // The LoupedeckDriver mock's discover should have been called
      // Access the internal driver (hacky but necessary for unit test)
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      expect(drivers[0].discover).toHaveBeenCalled();
    });

    it('should emit device-connected when a new device is discovered', async () => {
      const device = createMockManagedDevice();
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockResolvedValueOnce([device]);

      const connectedSpy = vi.fn();
      dm.on('device-connected', connectedSpy);

      await dm.discover();

      expect(connectedSpy).toHaveBeenCalledTimes(1);
      expect(connectedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mock-device-001', name: 'Mock Device' })
      );
    });

    it('should not register the same device twice', async () => {
      const device = createMockManagedDevice();
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockResolvedValue([device]);

      const connectedSpy = vi.fn();
      dm.on('device-connected', connectedSpy);

      await dm.discover();
      await dm.discover();

      expect(connectedSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle driver errors gracefully', async () => {
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('USB error'));

      await expect(dm.discover()).resolves.not.toThrow();
    });
  });

  // ─── Event Forwarding ────────────────────────────────────

  describe('event forwarding', () => {
    let device: ManagedDevice & EventEmitter;

    beforeEach(async () => {
      device = createMockManagedDevice();
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockResolvedValueOnce([device]);
      await dm.discover();
    });

    it('should forward button-down events from devices', () => {
      const spy = vi.fn();
      dm.on('button-down', spy);

      device.emit('down', { buttonIndex: 3 });

      expect(spy).toHaveBeenCalledWith({
        deviceId: 'mock-device-001',
        buttonIndex: 3
      });
    });

    it('should forward button-up events from devices', () => {
      const spy = vi.fn();
      dm.on('button-up', spy);

      device.emit('up', { buttonIndex: 7 });

      expect(spy).toHaveBeenCalledWith({
        deviceId: 'mock-device-001',
        buttonIndex: 7
      });
    });

    it('should forward knob-rotate events', () => {
      const spy = vi.fn();
      dm.on('knob-rotate', spy);

      device.emit('rotate', { knobId: 'knob-left', delta: 1 });

      expect(spy).toHaveBeenCalledWith({
        deviceId: 'mock-device-001',
        knobId: 'knob-left',
        delta: 1
      });
    });

    it('should forward knob-press events', () => {
      const spy = vi.fn();
      dm.on('knob-press', spy);

      device.emit('knob-press', { knobId: 'knob-right' });

      expect(spy).toHaveBeenCalledWith({
        deviceId: 'mock-device-001',
        knobId: 'knob-right'
      });
    });

    it('should emit device-disconnected on device disconnect', async () => {
      const spy = vi.fn();
      dm.on('device-disconnected', spy);

      device.emit('disconnect');
      // The disconnect handler is async — wait for it to complete
      await vi.advanceTimersByTimeAsync(0);

      expect(spy).toHaveBeenCalledWith('mock-device-001');
    });
  });

  // ─── Polling ──────────────────────────────────────────────

  describe('polling', () => {
    it('should poll for devices at the specified interval', async () => {
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      dm.startPolling(2000);

      await vi.advanceTimersByTimeAsync(6000);
      expect(drivers[0].discover).toHaveBeenCalled();

      dm.stopPolling();
    });

    it('should not start multiple polling intervals', () => {
      dm.startPolling(1000);
      dm.startPolling(1000); // Should be a no-op
      dm.stopPolling();
    });
  });

  // ─── Device Accessors ─────────────────────────────────────

  describe('device accessors', () => {
    beforeEach(async () => {
      const device = createMockManagedDevice('dev-A', 'Device A');
      const device2 = createMockManagedDevice('dev-B', 'Device B');
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockResolvedValueOnce([device, device2]);
      await dm.discover();
    });

    it('should return device info for first device', () => {
      const info = dm.getDeviceInfo();
      expect(info).not.toBeNull();
      expect(info!.id).toBe('dev-A');
    });

    it('should return all device infos', () => {
      const infos = dm.getAllDeviceInfos();
      expect(infos).toHaveLength(2);
    });

    it('should get a device by ID', () => {
      const device = dm.getDevice('dev-B');
      expect(device).toBeDefined();
      expect(device!.id).toBe('dev-B');
    });

    it('should return undefined for unknown device ID', () => {
      expect(dm.getDevice('unknown')).toBeUndefined();
    });

    it('should return null info when no devices connected', () => {
      const emptyDm = new DeviceManager();
      expect(emptyDm.getDeviceInfo()).toBeNull();
    });
  });

  // ─── Disconnect All ───────────────────────────────────────

  describe('disconnectAll', () => {
    it('should disconnect all devices and clear the map', async () => {
      const device = createMockManagedDevice();
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockResolvedValueOnce([device]);
      await dm.discover();

      expect(dm.getAllDevices()).toHaveLength(1);
      await dm.disconnectAll();
      expect(dm.getAllDevices()).toHaveLength(0);
    });
  });

  // ─── Dispose ──────────────────────────────────────────────

  describe('dispose', () => {
    it('should stop polling, disconnect all, and dispose drivers', async () => {
      dm.startPolling(1000);
      const device = createMockManagedDevice();
      const drivers = (dm as unknown as { drivers: DeviceDriver[] }).drivers;
      (drivers[0].discover as ReturnType<typeof vi.fn>).mockResolvedValueOnce([device]);
      await dm.discover();

      await dm.dispose();
      expect(dm.getAllDevices()).toHaveLength(0);
      expect(drivers[0].dispose).toHaveBeenCalled();
    });
  });
});
