import type { DeviceDriver, ManagedDevice } from '../types';
import type { VirtualDeviceConfig, VirtualDevicesData } from './VirtualDeviceConfig';
import {
  validateVirtualDeviceConfig,
  buildVirtualEncoders,
  buildVirtualSliders,
  generateVirtualDeviceId
} from './VirtualDeviceConfig';
import { VirtualManagedDevice } from './VirtualManagedDevice';
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const VIRTUAL_DEVICES_FILE = 'virtual-devices.json';

/**
 * Virtual device driver — manages software-only stream deck devices.
 *
 * Unlike hardware drivers, virtual devices are user-created and persisted to
 * disk. The `discover()` method returns any configured virtual devices that
 * haven't been registered yet by DeviceManager.
 */
export class VirtualDriver implements DeviceDriver {
  name = 'Virtual';
  private devices: Map<string, VirtualManagedDevice> = new Map();
  private configs: Map<string, VirtualDeviceConfig> = new Map();
  private dataPath: string;
  private loaded = false;

  constructor(dataPath?: string) {
    this.dataPath = dataPath ?? path.join(app.getPath('userData'), VIRTUAL_DEVICES_FILE);
  }

  // ─── Persistence ─────────────────────────────────────────────

  /** Load virtual device configs from disk */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.dataPath, 'utf-8');
      const data: VirtualDevicesData = JSON.parse(raw);
      if (data.devices && Array.isArray(data.devices)) {
        for (const config of data.devices) {
          const error = validateVirtualDeviceConfig(config);
          if (!error) {
            this.configs.set(config.id, config);
          } else {
            console.warn(`[VirtualDriver] Skipping invalid config "${config.id}": ${error}`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error('[VirtualDriver] Failed to load virtual devices:', err);
      }
      // No file yet — that's fine, start with no virtual devices
    }
    this.loaded = true;
    console.log(`[VirtualDriver] Loaded ${this.configs.size} virtual device config(s)`);
  }

  /** Save current configs to disk */
  private async save(): Promise<void> {
    const data: VirtualDevicesData = {
      devices: Array.from(this.configs.values())
    };
    const dir = path.dirname(this.dataPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  /** Create a new virtual device from config. Returns the managed device. */
  async createDevice(config: VirtualDeviceConfig): Promise<VirtualManagedDevice> {
    // Auto-generate an ID if the caller didn't provide one
    if (!config.id) {
      config = { ...config, id: generateVirtualDeviceId() };
    }

    const error = validateVirtualDeviceConfig(config);
    if (error) throw new Error(`Invalid virtual device config: ${error}`);

    if (this.configs.has(config.id)) {
      throw new Error(`Virtual device "${config.id}" already exists`);
    }

    this.configs.set(config.id, config);
    await this.save();

    const device = this.instantiateDevice(config);
    return device;
  }

  /** Update an existing virtual device config.
   *  Returns the new managed device (old one is disconnected). */
  async updateDevice(config: VirtualDeviceConfig): Promise<VirtualManagedDevice> {
    const error = validateVirtualDeviceConfig(config);
    if (error) throw new Error(`Invalid virtual device config: ${error}`);

    if (!this.configs.has(config.id)) {
      throw new Error(`Virtual device "${config.id}" not found`);
    }

    // Disconnect the old instance
    const existing = this.devices.get(config.id);
    if (existing) {
      await existing.disconnect();
      this.devices.delete(config.id);
    }

    this.configs.set(config.id, config);
    await this.save();

    const device = this.instantiateDevice(config);
    return device;
  }

  /** Delete a virtual device by ID. Disconnects it if active. */
  async deleteDevice(id: string): Promise<void> {
    const existing = this.devices.get(id);
    if (existing) {
      await existing.disconnect();
      this.devices.delete(id);
    }
    this.configs.delete(id);
    await this.save();
  }

  /** Get all configured virtual device configs */
  getConfigs(): VirtualDeviceConfig[] {
    return Array.from(this.configs.values());
  }

  /** Get a specific config by ID */
  getConfig(id: string): VirtualDeviceConfig | undefined {
    return this.configs.get(id);
  }

  /** Get a managed device instance by ID (if active) */
  getDevice(id: string): VirtualManagedDevice | undefined {
    return this.devices.get(id);
  }

  // ─── DeviceDriver interface ──────────────────────────────────

  /**
   * Discover virtual devices.
   * Returns any configured devices that aren't already instantiated.
   * Must call `load()` before first discover.
   */
  async discover(): Promise<ManagedDevice[]> {
    if (!this.loaded) {
      await this.load();
    }

    const newDevices: ManagedDevice[] = [];
    for (const config of this.configs.values()) {
      if (!this.devices.has(config.id)) {
        const device = this.instantiateDevice(config);
        newDevices.push(device);
      }
    }
    return newDevices;
  }

  async dispose(deviceId?: string): Promise<void> {
    if (deviceId) {
      const device = this.devices.get(deviceId);
      if (device) {
        this.devices.delete(deviceId);
        await device.disconnect();
      }
    } else {
      const all = Array.from(this.devices.values());
      this.devices.clear();
      for (const device of all) {
        await device.disconnect();
      }
    }
  }

  // ─── Internal ─────────────────────────────────────────────────

  /** Create a VirtualManagedDevice from config and track it */
  private instantiateDevice(config: VirtualDeviceConfig): VirtualManagedDevice {
    const knobs = buildVirtualEncoders(config);
    const sliders = buildVirtualSliders(config);
    const device = new VirtualManagedDevice(config, knobs, sliders);

    this.devices.set(config.id, device);

    device.on('disconnect', () => {
      this.devices.delete(config.id);
    });

    return device;
  }
}
