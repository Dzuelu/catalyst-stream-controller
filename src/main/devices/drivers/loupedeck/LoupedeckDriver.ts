import type { DeviceDriver, ManagedDevice } from '../../types';
import type { DeviceInfo, SafeAreaInsets, ButtonAppearance, KnobControl, Control } from '../../../../shared/types';
import { buildButtonGrid } from '../../types';
import type { DeviceDescriptor } from './lib/types';
import type { LoupedeckDevice } from './lib/devices/base';
import { listDevices } from './lib/discovery';
import { rgba2rgb565 } from './lib/util';

import { renderKey as keyRendererRenderKey } from '../../../rendering/KeyRenderer';
import type * as CanvasModule from 'canvas';

// node-canvas for decoding rendered PNGs to RGBA pixel data
// eslint-disable-next-line @typescript-eslint/no-require-imports
const canvasModule: typeof CanvasModule = require('canvas');

// ─── Knob metadata ───────────────────────────────────────────
const KNOB_META: Record<string, { label: string; side: 'left' | 'right' }> = {
  knobTL: { label: 'Top Left', side: 'left' },
  knobCL: { label: 'Center Left', side: 'left' },
  knobBL: { label: 'Bottom Left', side: 'left' },
  knobTR: { label: 'Top Right', side: 'right' },
  knobCR: { label: 'Center Right', side: 'right' },
  knobBR: { label: 'Bottom Right', side: 'right' }
};

// ─── Default safe area insets per device type ────────────────
const DEFAULT_INSETS: Record<string, SafeAreaInsets> = {
  'Razer Stream Controller X': { top: 2, bottom: 20, left: 10, right: 10 }
};
const FALLBACK_INSETS: SafeAreaInsets = { top: 4, bottom: 4, left: 4, right: 4 };

// ─── Driver ──────────────────────────────────────────────────

export class LoupedeckDriver implements DeviceDriver {
  name = 'Loupedeck';
  private devices: Map<string, LoupedeckManagedDevice> = new Map();

  /** Addresses of devices currently managed (for dedup during discovery) */
  private get managedAddresses(): Set<string> {
    const addrs = new Set<string>();
    for (const d of this.devices.values()) {
      if (d.address) addrs.add(d.address);
    }
    return addrs;
  }

  async discover(): Promise<ManagedDevice[]> {
    try {
      const descriptors = await listDevices();
      if (!descriptors.length) return [];

      // Filter out devices we already manage
      const managed = this.managedAddresses;
      const newDescs = descriptors.filter((d) => d.address && !managed.has(d.address));
      if (!newDescs.length) return [];

      const results: ManagedDevice[] = [];
      for (const desc of newDescs) {
        const device = await this.connectToDescriptor(desc);
        if (device) results.push(device);
      }
      return results;
    } catch (error) {
      console.error('[LoupedeckDriver] Discovery error:', error);
      return [];
    }
  }

  private async connectToDescriptor(desc: DeviceDescriptor): Promise<LoupedeckManagedDevice | null> {
    // Try primary transport, then any fallback transports in priority order
    const attempts: { transport: string; connect: () => Promise<LoupedeckManagedDevice> }[] = [
      {
        transport: desc.transport,
        connect: async () => {
          const rawDevice = (await desc.connect({ reconnectInterval: 0 })) as unknown as LoupedeckDevice;
          const managed = new LoupedeckManagedDevice(rawDevice, desc.address);
          await managed.init();
          return managed;
        }
      }
    ];

    // Add fallback transports (e.g. serial when HID fails on Linux)
    if (desc.fallbackTransports) {
      for (const fb of desc.fallbackTransports) {
        attempts.push({
          transport: fb.transport,
          connect: async () => {
            const rawDevice = (await desc.connect({
              reconnectInterval: 0,
              address: fb.address,
              portRef: fb.portRef,
              transport: fb.transport
            })) as unknown as LoupedeckDevice;
            const managed = new LoupedeckManagedDevice(rawDevice, fb.address ?? desc.address);
            await managed.init();
            return managed;
          }
        });
      }
    }

    for (const attempt of attempts) {
      try {
        const managed = await attempt.connect();
        this.devices.set(managed.id, managed);
        managed.on('disconnect', () => {
          this.devices.delete(managed.id);
        });
        return managed;
      } catch (error) {
        const msg = String(error);
        const isTransient =
          msg.includes('No such file') ||
          msg.includes('ENOENT') ||
          msg.includes('Cannot lock') ||
          msg.includes('temporarily unavailable') ||
          msg.includes('socket hang up') ||
          msg.includes('handshake timed out') ||
          msg.includes('No devices found');

        if (attempts.indexOf(attempt) < attempts.length - 1) {
          // More transports to try — log and continue
          console.warn(
            `[LoupedeckDriver] ${attempt.transport} transport failed, trying next fallback:`,
            isTransient ? msg : error
          );
          continue;
        }

        // Last attempt failed
        if (!isTransient) {
          console.error('[LoupedeckDriver] Connection error:', error);
        }
        return null;
      }
    }

    return null;
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
}

// ─── Managed Device ──────────────────────────────────────────

class LoupedeckManagedDevice implements ManagedDevice {
  id: string;
  /** Transport address used to detect duplicate connections */
  address: string | undefined;
  private device: LoupedeckDevice;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private deviceInfo: DeviceInfo;
  private disconnected = false;
  private insets: SafeAreaInsets;

  constructor(device: LoupedeckDevice, address?: string) {
    this.device = device;
    this.address = address;
    this.id = `loupedeck-${Date.now()}`;

    // Use device metadata directly — no constructor name matching
    this.insets = DEFAULT_INSETS[device.type] ?? { ...FALLBACK_INSETS };

    // Build controls from device metadata
    const knobs: KnobControl[] = device.knobs.map((knobId: string) => {
      const meta = KNOB_META[knobId] ?? { label: knobId, side: 'left' as const };
      return { type: 'knob' as const, id: knobId, label: meta.label, side: meta.side };
    });

    const controls: Control[] = [...buildButtonGrid(device.rows, device.columns), ...knobs];

    this.deviceInfo = {
      id: this.id,
      name: device.type,
      rows: device.rows,
      cols: device.columns,
      keySize: device.keySize,
      controls,
      connected: true,
      safeAreaInsets: { ...this.insets }
    };

    this.setupEventForwarding();
  }

  /** Fetch device serial and firmware info. Must be called after construction. */
  async init(): Promise<void> {
    try {
      const info = await this.device.getInfo();
      this.deviceInfo.serial = info.serial;
      this.deviceInfo.firmwareVersion = info.version;

      // Use serial number for a stable device ID
      if (info.serial) {
        const stableId = `loupedeck-${info.serial}`;
        this.id = stableId;
        this.deviceInfo.id = stableId;
      }
    } catch {
      console.warn('[LoupedeckDevice] Could not fetch device info');
    }
  }

  /** Handle the disconnect flow exactly once */
  private handleDisconnect(reason?: string): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.deviceInfo.connected = false;
    if (reason) {
      console.log(`[LoupedeckDevice] Disconnected: ${reason}`);
    }
    try {
      this.device.close();
    } catch {
      /* device may already be gone */
    }
    this.emitLocal('disconnect');
  }

  private setupEventForwarding(): void {
    // The loupedeck library emits 'down'/'up' for BOTH button presses
    // (numeric id) and knob presses (string id like 'knobTL').
    this.device.on('down', ({ id }: { id: number | string }) => {
      if (this.disconnected) return;
      if (typeof id === 'string') {
        this.emitLocal('knob-press', { knobId: id });
      } else {
        this.emitLocal('down', { buttonIndex: id });
      }
    });

    this.device.on('up', ({ id }: { id: number | string }) => {
      if (this.disconnected) return;
      if (typeof id !== 'string') {
        this.emitLocal('up', { buttonIndex: id });
      }
    });

    this.device.on('rotate', ({ id, delta }: { id: string; delta: number }) => {
      if (this.disconnected) return;
      this.emitLocal('rotate', { knobId: id, delta });
    });

    this.device.on('disconnect', (error?: Error) => {
      this.handleDisconnect(error?.message ?? 'device disconnected');
    });
  }

  getInfo(): DeviceInfo {
    return { ...this.deviceInfo };
  }

  async setBrightness(brightness: number): Promise<void> {
    if (this.disconnected) return;
    const clamped = Math.max(0, Math.min(1, brightness));
    await this.device.setBrightness(clamped);
  }

  async drawKey(keyIndex: number, appearance: ButtonAppearance, pluginImageDataUri?: string): Promise<void> {
    if (this.disconnected) return;
    try {
      const keySize = this.deviceInfo.keySize;

      // Render all layers via KeyRenderer → PNG data URI
      const pngDataUri = await keyRendererRenderKey(appearance, this.insets, keySize, keySize, pluginImageDataUri);

      // Decode PNG → RGBA → RGB565
      const matches = pngDataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) return;
      const pngBuf = Buffer.from(matches[2], 'base64');
      const img = await canvasModule.loadImage(pngBuf);
      const canvas = canvasModule.createCanvas(keySize, keySize);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, keySize, keySize);
      const imageData = ctx.getImageData(0, 0, keySize, keySize);
      const rgb565 = rgba2rgb565(imageData.data, keySize * keySize);

      await this.device.drawKey(keyIndex, rgb565);
    } catch (error) {
      if (!this.disconnected) {
        console.error(`[LoupedeckDevice] Failed to draw key ${keyIndex}:`, error);
      }
    }
  }

  /** Draw calibration guides on all keys so users can measure bezel coverage */
  async drawCalibration(): Promise<void> {
    if (this.disconnected) return;
    const { rows, cols, keySize } = this.deviceInfo;
    const totalKeys = rows * cols;
    const insets = this.insets;

    for (let keyIndex = 0; keyIndex < totalKeys; keyIndex++) {
      try {
        const canvas = canvasModule.createCanvas(keySize, keySize);
        const ctx = canvas.getContext('2d');

        // Dark background
        ctx.fillStyle = '#0f0f14';
        ctx.fillRect(0, 0, keySize, keySize);

        // Subtle grid lines every 6px
        ctx.strokeStyle = '#2a2a3a';
        ctx.lineWidth = 1;
        for (let x = 0; x <= keySize; x += 6) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, keySize);
          ctx.stroke();
        }
        for (let y = 0; y <= keySize; y += 6) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(keySize, y);
          ctx.stroke();
        }

        // Safe area outline
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          insets.left,
          insets.top,
          keySize - insets.left - insets.right,
          keySize - insets.top - insets.bottom
        );

        // Key label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Key ${keyIndex}`, keySize / 2, keySize / 2);

        // Convert to RGB565 and send
        const imageData = ctx.getImageData(0, 0, keySize, keySize);
        const rgb565 = rgba2rgb565(imageData.data, keySize * keySize);
        await this.device.drawKey(keyIndex, rgb565);
      } catch {
        // Ignore draw errors during calibration
      }
    }
    console.log('[LoupedeckDevice] Calibration drawn. Green outline shows current safe area.');
  }

  setKeyInsets(newInsets: SafeAreaInsets): void {
    this.insets = { ...newInsets };
    this.deviceInfo.safeAreaInsets = { ...newInsets };
    console.log(
      `[LoupedeckDevice] Safe area insets updated: ` +
        `T=${newInsets.top} B=${newInsets.bottom} L=${newInsets.left} R=${newInsets.right}`
    );
  }

  async disconnect(): Promise<void> {
    this.handleDisconnect('manual disconnect');
  }

  on(event: 'down', handler: (data: { buttonIndex: number }) => void): void;
  on(event: 'up', handler: (data: { buttonIndex: number }) => void): void;
  on(event: 'rotate', handler: (data: { knobId: string; delta: number }) => void): void;
  on(event: 'knob-press', handler: (data: { knobId: string }) => void): void;
  on(event: 'disconnect', handler: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitLocal(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}
