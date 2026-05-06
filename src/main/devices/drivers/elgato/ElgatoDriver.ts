import type { DeviceDriver, ManagedDevice } from '../../types';
import type { DeviceInfo, SafeAreaInsets, ButtonAppearance, KnobControl, Control } from '../../../../shared/types';
import { buildButtonGrid } from '../../types';
import type {
  StreamDeck,
  StreamDeckDeviceInfo,
  StreamDeckButtonControlDefinition,
  StreamDeckEncoderControlDefinition,
  DeviceModelId
} from '@elgato-stream-deck/node';
import type * as StreamDeckNS from '@elgato-stream-deck/node';
import type * as CanvasModule from 'canvas';

import { renderKey as keyRendererRenderKey } from '../../../rendering/KeyRenderer';

// node-canvas for decoding rendered PNGs into raw pixel buffers
// eslint-disable-next-line @typescript-eslint/no-require-imports
const canvasModule: typeof CanvasModule = require('canvas');

// ─── Dynamic import for @elgato-stream-deck/node ────────────────
// The package is ESM; we lazy-import it so that startup isn't
// blocked when no Elgato devices are present.
let sdModule: typeof StreamDeckNS | null = null;
async function importStreamDeck(): Promise<typeof StreamDeckNS> {
  if (!sdModule) {
    sdModule = await import('@elgato-stream-deck/node');
  }
  return sdModule;
}

// ─── ElgatoDriver ───────────────────────────────────────────────

export class ElgatoDriver implements DeviceDriver {
  name = 'Elgato';
  private devices: Map<string, ElgatoManagedDevice> = new Map();

  /** Get paths of devices we already manage */
  private get managedPaths(): Set<string> {
    const paths = new Set<string>();
    for (const device of this.devices.values()) {
      if (device.hidPath) paths.add(device.hidPath);
    }
    return paths;
  }

  /** Try to open a single Stream Deck at the given HID path */
  private async connectToPath(info: StreamDeckDeviceInfo): Promise<ElgatoManagedDevice | null> {
    try {
      const { openStreamDeck } = await importStreamDeck();
      const rawDevice = await openStreamDeck(info.path, {
        resetToLogoOnClose: false
      });

      const managed = new ElgatoManagedDevice(rawDevice, info);
      await managed.init();
      this.devices.set(managed.id, managed);

      // Remove from internal map on disconnect
      managed.on('disconnect', () => {
        this.devices.delete(managed.id);
      });

      return managed;
    } catch (error) {
      const msg = String(error);
      // Common non-fatal errors during discovery
      if (
        msg.includes('cannot open') ||
        msg.includes('ENOENT') ||
        msg.includes('could not read') ||
        msg.includes('access denied') ||
        msg.includes('device has been detached')
      ) {
        return null;
      }
      console.error('[ElgatoDriver] Connection error:', error);
      return null;
    }
  }

  async discover(): Promise<ManagedDevice[]> {
    try {
      const { listStreamDecks } = await importStreamDeck();
      const available = await listStreamDecks();
      if (!available || available.length === 0) return [];

      // Filter out already-managed devices
      const managed = this.managedPaths;
      const newDevices = available.filter((d) => d.path && !managed.has(d.path));
      if (newDevices.length === 0) return [];

      const results: ManagedDevice[] = [];
      for (const desc of newDevices) {
        const device = await this.connectToPath(desc);
        if (device) results.push(device);
      }
      return results;
    } catch (error) {
      console.error('[ElgatoDriver] Discovery error:', error);
      return [];
    }
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

// ─── ElgatoManagedDevice ────────────────────────────────────────

class ElgatoManagedDevice implements ManagedDevice {
  id: string;
  /** The HID path used to detect duplicate connections */
  hidPath: string;
  private rawDevice: StreamDeck;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private deviceInfo: DeviceInfo;
  private disconnected = false;
  private insets: SafeAreaInsets;

  // ─── Draw queue ─────────────────────────────────────────────
  // Serialises all drawKey calls so only one USB write is in flight
  // at a time.  Per-key coalescing keeps only the latest appearance.
  private drawQueue: Array<{
    keyIndex: number;
    appearance: ButtonAppearance;
    pluginImageDataUri?: string;
    resolve: () => void;
  }> = [];
  private drawInFlight = false;
  private static readonly DRAW_TIMEOUT_MS = 500;
  private consecutiveTimeouts = 0;

  constructor(rawDevice: StreamDeck, info: StreamDeckDeviceInfo) {
    this.rawDevice = rawDevice;
    this.hidPath = info.path;

    // Temporary ID until serial is fetched
    this.id = `elgato-${Date.now()}`;

    const layout = this.getLayoutForModel(rawDevice.MODEL);

    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };

    // Build controls from the library's CONTROLS array
    const controls: Control[] = this.buildControls(rawDevice);

    this.deviceInfo = {
      id: this.id,
      name: rawDevice.PRODUCT_NAME || this.getModelName(rawDevice.MODEL),
      rows: layout.rows,
      cols: layout.cols,
      keySize: layout.keySize,
      controls,
      connected: true,
      safeAreaInsets: { ...this.insets }
    };

    this.setupEventForwarding();
  }

  /** Fetch serial number and firmware. Must be called after construction. */
  async init(): Promise<void> {
    try {
      const serial = await this.rawDevice.getSerialNumber();
      if (serial) {
        this.id = `elgato-${serial}`;
        this.deviceInfo.id = this.id;
        this.deviceInfo.serial = serial;
      }
    } catch {
      console.warn('[ElgatoDevice] Could not fetch serial number');
    }

    try {
      const fw = await this.rawDevice.getFirmwareVersion();
      this.deviceInfo.firmwareVersion = fw;
    } catch {
      console.warn('[ElgatoDevice] Could not fetch firmware version');
    }
  }

  // ─── Model layout mapping ────────────────────────────────────

  private getLayoutForModel(model: DeviceModelId): {
    rows: number;
    cols: number;
    keySize: number;
  } {
    switch (model) {
      case 'mini':
        return { rows: 2, cols: 3, keySize: 80 };
      case 'original':
      case 'originalv2':
      case 'original-mk2':
      case 'original-mk2-scissor':
        return { rows: 3, cols: 5, keySize: 72 };
      case 'xl':
        return { rows: 4, cols: 8, keySize: 96 };
      case 'plus':
        return { rows: 2, cols: 4, keySize: 120 };
      case 'neo':
        return { rows: 2, cols: 4, keySize: 72 };
      case 'studio':
        return { rows: 4, cols: 8, keySize: 72 };
      case 'pedal':
        // Pedal has no display — 3 foot switches, no grid
        return { rows: 0, cols: 0, keySize: 0 };
      default:
        // Fallback: use the library's CONTROLS to infer layout if unknown
        return { rows: 3, cols: 5, keySize: 72 };
    }
  }

  private getModelName(model: DeviceModelId): string {
    const names: Record<string, string> = {
      original: 'Stream Deck',
      originalv2: 'Stream Deck V2',
      'original-mk2': 'Stream Deck MK.2',
      'original-mk2-scissor': 'Stream Deck MK.2 Scissor',
      mini: 'Stream Deck Mini',
      xl: 'Stream Deck XL',
      plus: 'Stream Deck +',
      neo: 'Stream Deck Neo',
      pedal: 'Stream Deck Pedal',
      studio: 'Stream Deck Studio',
      '6-module': 'Stream Deck Module 6',
      '15-module': 'Stream Deck Module 15',
      '32-module': 'Stream Deck Module 32',
      'network-dock': 'Stream Deck Network Dock',
      'galleon-k100': 'Stream Deck Galleon K100'
    };
    return names[model] ?? `Stream Deck (${model})`;
  }

  /** Build our Control[] from the library's CONTROLS array */
  private buildControls(device: StreamDeck): Control[] {
    const layout = this.getLayoutForModel(device.MODEL);
    const controls: Control[] = [];

    // Buttons — use buildButtonGrid for consistent row/col assignment
    if (layout.rows > 0 && layout.cols > 0) {
      controls.push(...buildButtonGrid(layout.rows, layout.cols));
    }

    // Encoders (knobs) — e.g. Stream Deck + has 4 bottom encoders
    const encoders = device.CONTROLS.filter((c): c is StreamDeckEncoderControlDefinition => c.type === 'encoder');
    for (const enc of encoders) {
      controls.push({
        type: 'knob',
        id: `encoder${enc.index}`,
        label: `Encoder ${enc.index + 1}`,
        side: 'bottom'
      } as KnobControl);
    }

    return controls;
  }

  // ─── Event forwarding ────────────────────────────────────────

  private handleDisconnect(reason?: string): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.deviceInfo.connected = false;
    if (reason) {
      console.log(`[ElgatoDevice] Disconnected: ${reason}`);
    }

    // Close the raw device — ignore errors if already gone
    try {
      this.rawDevice.close();
    } catch {
      /* ignore */
    }

    this.emitLocal('disconnect');
  }

  private setupEventForwarding(): void {
    this.rawDevice.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ElgatoDevice] Device error:', msg);
      this.handleDisconnect(msg);
    });

    // Button press/release — the library passes the control definition
    this.rawDevice.on('down', (control: StreamDeckButtonControlDefinition | StreamDeckEncoderControlDefinition) => {
      if (this.disconnected) return;
      if (control.type === 'button') {
        this.emitLocal('down', { buttonIndex: control.index });
      } else if (control.type === 'encoder') {
        // Encoder press → knob-press event
        this.emitLocal('knob-press', { knobId: `encoder${control.index}` });
      }
    });

    this.rawDevice.on('up', (control: StreamDeckButtonControlDefinition | StreamDeckEncoderControlDefinition) => {
      if (this.disconnected) return;
      if (control.type === 'button') {
        this.emitLocal('up', { buttonIndex: control.index });
      }
      // Encoder release — no action needed currently
    });

    // Encoder rotation
    this.rawDevice.on('rotate', (control: StreamDeckEncoderControlDefinition, amount: number) => {
      if (this.disconnected) return;
      this.emitLocal('rotate', { knobId: `encoder${control.index}`, delta: amount });
    });
  }

  // ─── ManagedDevice interface ─────────────────────────────────

  getInfo(): DeviceInfo {
    return { ...this.deviceInfo };
  }

  async setBrightness(brightness: number): Promise<void> {
    if (this.disconnected) return;
    // Our interface uses 0-1, the library uses 0-100
    const percent = Math.round(Math.max(0, Math.min(1, brightness)) * 100);
    await this.rawDevice.setBrightness(percent);
  }

  async drawKey(keyIndex: number, appearance: ButtonAppearance, pluginImageDataUri?: string): Promise<void> {
    if (this.disconnected) return;

    // Coalesce: if there's already a queued draw for this key, replace it
    const existingIdx = this.drawQueue.findIndex((q) => q.keyIndex === keyIndex);
    if (existingIdx !== -1) {
      this.drawQueue[existingIdx].resolve();
      this.drawQueue[existingIdx] = {
        keyIndex,
        appearance,
        pluginImageDataUri,
        resolve: () => {}
      };
      return new Promise<void>((resolve) => {
        this.drawQueue[existingIdx].resolve = resolve;
      });
    }

    return new Promise<void>((resolve) => {
      this.drawQueue.push({ keyIndex, appearance, pluginImageDataUri, resolve });
      this.drainQueue();
    });
  }

  /** Process the draw queue one item at a time */
  private async drainQueue(): Promise<void> {
    if (this.drawInFlight || this.drawQueue.length === 0) return;

    this.drawInFlight = true;
    while (this.drawQueue.length > 0) {
      if (this.disconnected) {
        for (const item of this.drawQueue) item.resolve();
        this.drawQueue.length = 0;
        break;
      }

      const item = this.drawQueue.shift()!;
      try {
        await this.drawKeyInternal(item.keyIndex, item.appearance, item.pluginImageDataUri);
        this.consecutiveTimeouts = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('timed out')) {
          this.consecutiveTimeouts++;
          console.warn(
            `[ElgatoDevice] drawKey(${item.keyIndex}) timed out ` +
              `(${this.consecutiveTimeouts} consecutive). Device may be overwhelmed.`
          );
          if (this.consecutiveTimeouts >= 3) {
            console.error(
              `[ElgatoDevice] ${this.consecutiveTimeouts} consecutive draw timeouts — ` +
                `device appears unresponsive. Clearing draw queue (${this.drawQueue.length} pending).`
            );
            for (const q of this.drawQueue) q.resolve();
            this.drawQueue.length = 0;
          }
        } else if (!this.disconnected) {
          console.error(`[ElgatoDevice] drawKey(${item.keyIndex}) failed: ${msg}`);
        }
      }
      item.resolve();
    }
    this.drawInFlight = false;
  }

  /** Render + blit a single key (called only from drainQueue) */
  private async drawKeyInternal(
    keyIndex: number,
    appearance: ButtonAppearance,
    pluginImageDataUri?: string
  ): Promise<void> {
    if (this.disconnected) return;
    const timeoutMs = ElgatoManagedDevice.DRAW_TIMEOUT_MS;

    const drawPromise = this.renderAndBlit(keyIndex, appearance, pluginImageDataUri);

    const result = await Promise.race([
      drawPromise.then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
    ]);

    if (result === 'timeout') {
      throw new Error(`drawKey(${keyIndex}) timed out after ${timeoutMs}ms`);
    }
  }

  /** Render layers via KeyRenderer → PNG, decode to RGBA, blit to device */
  private async renderAndBlit(
    keyIndex: number,
    appearance: ButtonAppearance,
    pluginImageDataUri?: string
  ): Promise<void> {
    if (this.disconnected) return;
    try {
      const keySize = this.deviceInfo.keySize;
      if (keySize === 0) return; // No display (e.g. Pedal)

      // Render all layers → PNG data URI
      const pngDataUri = await keyRendererRenderKey(appearance, this.insets, keySize, keySize, pluginImageDataUri);

      // Decode PNG → raw RGBA pixel buffer
      const matches = pngDataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) return;
      const pngBuffer = Buffer.from(matches[2], 'base64');
      const img = await canvasModule.loadImage(pngBuffer);

      const canvas = canvasModule.createCanvas(keySize, keySize);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, keySize, keySize);
      const imageData = ctx.getImageData(0, 0, keySize, keySize);
      const rgbaBuffer = Buffer.from(imageData.data);

      await this.rawDevice.fillKeyBuffer(keyIndex, rgbaBuffer, { format: 'rgba' });
    } catch (error) {
      if (!this.disconnected) {
        console.error(`[ElgatoDevice] Failed to draw key ${keyIndex}:`, error);
      }
    }
  }

  /** Draw calibration guides on all keys */
  async drawCalibration(): Promise<void> {
    if (this.disconnected) return;
    const { rows, cols, keySize } = this.deviceInfo;
    if (keySize === 0) return;

    const totalKeys = rows * cols;
    const insets = this.insets;

    for (let keyIndex = 0; keyIndex < totalKeys; keyIndex++) {
      try {
        const canvas = canvasModule.createCanvas(keySize, keySize);
        const ctx = canvas.getContext('2d');

        // Dark background
        ctx.fillStyle = '#0f0f14';
        ctx.fillRect(0, 0, keySize, keySize);

        // Grid lines every 6px
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

        // Extract RGBA and send
        const imageData = ctx.getImageData(0, 0, keySize, keySize);
        const rgbaBuffer = Buffer.from(imageData.data);
        await this.rawDevice.fillKeyBuffer(keyIndex, rgbaBuffer, { format: 'rgba' });
      } catch {
        // Ignore draw errors during calibration
      }
    }
    console.log('[ElgatoDevice] Calibration drawn. Green outline shows current safe area.');
  }

  setKeyInsets(newInsets: SafeAreaInsets): void {
    this.insets = { ...newInsets };
    this.deviceInfo.safeAreaInsets = { ...newInsets };
    console.log(
      `[ElgatoDevice] Safe area insets updated: T=${newInsets.top} B=${newInsets.bottom} L=${newInsets.left} R=${newInsets.right}`
    );
  }

  async disconnect(): Promise<void> {
    this.handleDisconnect('manual disconnect');
  }

  // ─── Local event emitter ─────────────────────────────────────

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

  private emitLocal(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (err) {
          console.error(`[ElgatoDevice] Error in event handler for '${event}':`, err);
        }
      }
    }
  }
}
