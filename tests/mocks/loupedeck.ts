import { vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { DeviceInfo, SafeAreaInsets, ButtonAppearance } from '@shared/types';

/**
 * Mock for the `loupedeck` module.
 *
 * Provides a mock ManagedDevice-like object and mock discovery function.
 * The mock device emits events (down, up, rotate, knob-press, disconnect)
 * that tests can trigger via helper methods.
 */

/** Creates a mock device with sensible defaults for Razer Stream Controller X */
export function createMockDevice(overrides: Partial<{ id: string; name: string; serial: string }> = {}) {
  const device = new MockLoupedeckDevice(overrides);
  return device;
}

export class MockLoupedeckDevice extends EventEmitter {
  id: string;
  private serial: string;
  private name: string;

  setBrightness = vi.fn(async (_brightness: number) => {});
  drawKey = vi.fn(async (_keyIndex: number, _appearance: ButtonAppearance) => {});
  drawCalibration = vi.fn(async () => {});
  setKeyInsets = vi.fn((_insets: SafeAreaInsets) => {});
  disconnect = vi.fn(async () => {
    this.emit('disconnect');
  });
  close = vi.fn(async () => {});
  drawScreen = vi.fn(async () => {});
  vibrate = vi.fn(async () => {});

  constructor(overrides: Partial<{ id: string; name: string; serial: string }> = {}) {
    super();
    this.id = overrides.id ?? 'mock-device-001';
    this.name = overrides.name ?? 'Razer Stream Controller X (Mock)';
    this.serial = overrides.serial ?? 'MOCK-SERIAL-001';
  }

  getInfo(): DeviceInfo {
    return {
      id: this.id,
      name: this.name,
      serial: this.serial,
      firmwareVersion: '1.0.0-mock',
      rows: 3,
      cols: 5,
      keySize: 96,
      controls: [],
      connected: true,
      safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }
    };
  }

  // ─── Test Helpers ────────────────────────────────────────────

  /** Simulate a button press */
  _pressButton(buttonIndex: number): void {
    this.emit('down', { buttonIndex });
  }

  /** Simulate a button release */
  _releaseButton(buttonIndex: number): void {
    this.emit('up', { buttonIndex });
  }

  /** Simulate a knob rotation */
  _rotateKnob(knobId: string, delta: number): void {
    this.emit('rotate', { knobId, delta });
  }

  /** Simulate a knob press */
  _pressKnob(knobId: string): void {
    this.emit('knob-press', { knobId });
  }

  /** Simulate device disconnection */
  _disconnect(): void {
    this.emit('disconnect');
  }
}

/** Tracked mock devices for discover() to return */
let pendingDevices: MockLoupedeckDevice[] = [];

/** Queue devices for the next discover() call */
export function queueDevicesForDiscovery(...devices: MockLoupedeckDevice[]): void {
  pendingDevices.push(...devices);
}

/** Reset discovery queue */
export function resetMockLoupedeck(): void {
  pendingDevices = [];
}

/** Mock discovery function matching the loupedeck module API */
export const discover = vi.fn(async () => {
  const devices = [...pendingDevices];
  pendingDevices = [];
  return devices;
});

/** Mock LoupedeckDevice constructor (for type compat with the real module) */
export const LoupedeckDevice = MockLoupedeckDevice;
