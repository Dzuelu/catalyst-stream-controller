import { EventEmitter } from 'node:events';
import { platform } from 'node:os';
import type { DeviceInfo, DeviceButtonEvent, DeviceKnobEvent, DeviceSliderEvent } from '../../shared/types';
import type { DeviceDriver, ManagedDevice } from './types';
import { LoupedeckDriver } from './drivers/loupedeck/LoupedeckDriver';
import { ElgatoDriver } from './drivers/elgato/ElgatoDriver';

interface _DeviceManagerEvents {
  'device-connected': (info: DeviceInfo) => void;
  'device-disconnected': (deviceId: string) => void;
  'button-down': (event: DeviceButtonEvent) => void;
  'button-up': (event: DeviceButtonEvent) => void;
  'knob-rotate': (event: DeviceKnobEvent) => void;
  'knob-press': (event: { deviceId: string; knobId: string }) => void;
  'slider-change': (event: DeviceSliderEvent) => void;
}

export class DeviceManager extends EventEmitter {
  private drivers: DeviceDriver[] = [];
  private devices: Map<string, ManagedDevice> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isDiscovering = false;
  private shuttingDown = false;

  constructor() {
    super();
    // Register built-in hardware drivers
    this.drivers.push(new LoupedeckDriver());
    this.drivers.push(new ElgatoDriver());

    // On Linux, log helpful udev rules info if needed
    if (platform() === 'linux') {
      console.log(
        '[DeviceManager] Linux detected. If you have device connection issues, ' +
          'ensure udev rules are installed:\n' +
          '  sudo udevadm control --reload-rules && sudo udevadm trigger\n' +
          'Then unplug and re-plug the device.'
      );
    }
  }

  /** Add an additional driver (e.g. VirtualDriver) */
  registerDriver(driver: DeviceDriver): void {
    this.drivers.push(driver);
  }

  /** Discover and connect to available devices */
  async discover(): Promise<void> {
    if (this.isDiscovering) return;
    this.isDiscovering = true;

    try {
      for (const driver of this.drivers) {
        try {
          const newDevices = await driver.discover();
          for (const device of newDevices) {
            if (!this.devices.has(device.id)) {
              this.registerDevice(device, driver);
            }
          }
        } catch (error) {
          console.error(`[DeviceManager] Discovery failed for driver ${driver.name}:`, error);
        }
      }
    } finally {
      this.isDiscovering = false;
      console.log(`[DeviceManager] Discovery complete — ${this.devices.size} device(s) connected`);
    }
  }

  /** Start polling for hot-plugged devices */
  startPolling(intervalMs = 5000): void {
    if (this.pollInterval) return;
    console.log(`[DeviceManager] Polling for devices every ${intervalMs / 1000}s`);
    this.pollInterval = setInterval(async () => {
      // Always poll — new devices may be connected even if we already have some
      await this.discover();
    }, intervalMs);
  }

  /** Stop polling */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /** Register a newly connected device.
   *  Public so that VirtualDriver CRUD can register devices outside of discover(). */
  registerDevice(device: ManagedDevice, owningDriver: DeviceDriver): void {
    this.devices.set(device.id, device);

    const info = device.getInfo();
    console.log(`[DeviceManager] Device connected: ${info.name} (${device.id})`);

    // Forward device events
    device.on('down', ({ buttonIndex }) => {
      this.emit('button-down', { deviceId: device.id, buttonIndex });
    });

    device.on('up', ({ buttonIndex }) => {
      this.emit('button-up', { deviceId: device.id, buttonIndex });
    });

    device.on('rotate', ({ knobId, delta }) => {
      this.emit('knob-rotate', { deviceId: device.id, knobId, delta });
    });

    device.on('knob-press', ({ knobId }) => {
      this.emit('knob-press', { deviceId: device.id, knobId });
    });

    // Forward slider events (virtual devices only)
    try {
      device.on('slider-change' as 'down', (data: unknown) => {
        const { sliderId, value } = data as { sliderId: string; value: number };
        this.emit('slider-change', { deviceId: device.id, sliderId, value });
      });
    } catch {
      // Not all devices emit slider events — ignore
    }

    device.on('disconnect', async () => {
      console.log(`[DeviceManager] Device disconnected: ${device.id}`);
      this.devices.delete(device.id);

      // Dispose only this device in its owning driver (not all drivers)
      try {
        await owningDriver.dispose(device.id);
      } catch {
        /* ignore */
      }

      this.emit('device-disconnected', device.id);

      // Don't schedule reconnect if we're shutting down
      if (this.shuttingDown) return;

      // Pause discovery briefly to let the OS fully release the serial port.
      this.isDiscovering = true;
      console.log('[DeviceManager] Waiting 3s for serial port release...');
      setTimeout(() => {
        this.isDiscovering = false;
        console.log('[DeviceManager] Ready to reconnect — polling will retry');
      }, 3000);
    });

    this.emit('device-connected', info);
  }

  /** Get info for the first connected device (convenience) */
  getDeviceInfo(): DeviceInfo | null {
    const first = this.devices.values().next();
    if (first.done) return null;
    return first.value.getInfo();
  }

  /** Get info for all connected devices */
  getAllDeviceInfos(): DeviceInfo[] {
    return Array.from(this.devices.values()).map((d) => d.getInfo());
  }

  /** Get all connected devices */
  getAllDevices(): ManagedDevice[] {
    return Array.from(this.devices.values());
  }

  /** Get a device by ID */
  getDevice(id: string): ManagedDevice | undefined {
    return this.devices.get(id);
  }

  /** Get the first connected device (MVP convenience) */
  getFirstDevice(): ManagedDevice | undefined {
    const first = this.devices.values().next();
    return first.done ? undefined : first.value;
  }

  /** Disconnect all devices (with timeout to prevent hanging on quit) */
  async disconnectAll(): Promise<void> {
    this.shuttingDown = true;
    console.log(`[DeviceManager] Disconnecting all devices (${this.devices.size})...`);
    const disconnections = Array.from(this.devices.values()).map((d) =>
      d.disconnect().catch(() => {
        /* ignore per-device errors during shutdown */
      })
    );
    // Don't hang forever if a device disconnect stalls
    await Promise.race([Promise.allSettled(disconnections), new Promise((resolve) => setTimeout(resolve, 3000))]);
    this.devices.clear();
  }

  /** Clean up all drivers and devices */
  async dispose(): Promise<void> {
    this.stopPolling();
    await this.disconnectAll();
    for (const driver of this.drivers) {
      try {
        await driver.dispose();
      } catch {
        /* ignore */
      }
    }
  }
}
