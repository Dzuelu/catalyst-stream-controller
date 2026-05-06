import {
  BUTTONS,
  COMMANDS,
  HAPTIC,
  MAX_BRIGHTNESS,
  DEFAULT_RECONNECT_INTERVAL,
  type CommandValue,
  type HapticPattern
} from '../constants';
import { encodeCommand, decodeMessage } from '../protocol/commands';
import { TransactionManager } from '../protocol/transactions';
import { TypedEmitter } from '../typed-emitter';
import type {
  Transport,
  ConnectionState,
  DeviceEvents,
  DeviceOptions,
  DiscoveredDevice,
  DisplayInfo,
  Touch,
  TouchTarget,
  DrawOptions
} from '../types';

// ─── Color parsing (replaces 'color-rgba' dependency) ─────────
function parseHexColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
    }
    if (hex.length >= 6) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
  }
  throw new Error(`Unsupported color format: ${color}. Use hex (#rgb or #rrggbb).`);
}

// ─── Transport creation helpers (lazy-loaded) ─────────────────
async function createTransport(options: DeviceOptions): Promise<Transport> {
  switch (options.transport) {
    case 'hid': {
      const { HIDTransport } = await import('../transports/hid');
      return new HIDTransport(options.address!);
    }
    case 'websocket': {
      const { WebSocketTransport } = await import('../transports/websocket');
      return new WebSocketTransport(options.address!);
    }
    case 'web-serial': {
      const { WebSerialTransport } = await import('../transports/web-serial');
      return new WebSerialTransport(options.portRef as never);
    }
    case 'serial':
    default: {
      // On Linux, some firmware requires the HID interface to be opened
      // before serial delivers input events.  When a companion HID path
      // is known, use the hybrid transport which opens HID as a side
      // effect while routing all I/O through serial.
      if (options.hidAddress) {
        const { LinuxHybridTransport } = await import('../transports/linux-hybrid');
        return new LinuxHybridTransport(options.address!, options.hidAddress);
      }
      const { SerialTransport } = await import('../transports/serial');
      return new SerialTransport(options.address!);
    }
  }
}

/**
 * Base class for all Loupedeck-protocol devices.
 *
 * Provides:
 * - Transport-agnostic connection management with state machine
 * - Automatic reconnect with configurable interval
 * - Transaction-based command/response protocol with timeouts
 * - Drawing (buffer and optional canvas callback APIs)
 * - Typed event emission
 *
 * Subclasses define static device metadata (productId, vendorId, type,
 * display layout, buttons, knobs, etc.)
 */
export abstract class LoupedeckDevice extends TypedEmitter<DeviceEvents> {
  // ─── Static metadata (override in subclasses) ──────────────
  static productId: number;
  static vendorId: number;

  abstract readonly type: string;
  abstract readonly columns: number;
  abstract readonly rows: number;
  abstract readonly displays: Record<string, DisplayInfo>;
  abstract readonly buttons: readonly (number | string)[];
  abstract readonly knobs: readonly string[];
  abstract readonly visibleX: readonly [number, number];

  keySize = 90;

  // ─── Instance state ─────────────────────────────────────────
  transport: Transport | null = null;
  private transactions = new TransactionManager();
  private touches: Record<number, Touch> = {};
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  reconnectInterval: number;

  /** Command handlers indexed by firmware command byte */
  private handlers: Partial<Record<number, (buff: Buffer) => unknown>>;

  // ─── Options stored for reconnect ──────────────────────────
  private options: DeviceOptions;

  constructor(options: DeviceOptions = {}) {
    super();
    this.options = options;
    this.reconnectInterval = options.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL;

    this.handlers = {
      [COMMANDS.BUTTON_PRESS]: this.onButton.bind(this),
      [COMMANDS.KNOB_ROTATE]: this.onRotate.bind(this),
      [COMMANDS.SERIAL]: (buff) => buff.toString().trim(),
      [COMMANDS.TICK]: () => {
        /* no-op */
      },
      [COMMANDS.TOUCH]: this.onTouch.bind(this, 'touchmove'),
      [COMMANDS.TOUCH_END]: this.onTouch.bind(this, 'touchend'),
      [COMMANDS.VERSION]: (buff) => `${buff[0]}.${buff[1]}.${buff[2]}`,
      [COMMANDS.TOUCH_CT]: this.onTouch.bind(this, 'touchmove'),
      [COMMANDS.TOUCH_END_CT]: this.onTouch.bind(this, 'touchend')
    };
  }

  // ─── Static discovery ───────────────────────────────────────
  /** List available devices across all transports. */
  static async list(
    opts: { ignoreSerial?: boolean; ignoreWebsocket?: boolean; ignoreHid?: boolean } = {}
  ): Promise<DiscoveredDevice[]> {
    const promises: Promise<DiscoveredDevice[]>[] = [];

    // Always launch all enabled transports in parallel — priority/dedup
    // is handled by the caller (listDevices) or by the consumer.
    if (!opts.ignoreSerial) {
      promises.push(import('../transports/serial').then((m) => m.SerialTransport.discover()).catch(() => []));
    }
    if (!opts.ignoreWebsocket) {
      promises.push(import('../transports/websocket').then((m) => m.WebSocketTransport.discover()).catch(() => []));
    }
    if (!opts.ignoreHid) {
      promises.push(import('../transports/hid').then((m) => m.HIDTransport.discover()).catch(() => []));
    }

    const results = await Promise.all(promises);
    return results.flat();
  }

  // ─── Connection lifecycle ───────────────────────────────────

  get connectionState(): ConnectionState {
    return this.transport?.state ?? 'disconnected';
  }

  async connect(): Promise<void> {
    // If we already have an explicit transport, just connect it
    if (this.transport?.state === 'disconnected') {
      this.wireTransport(this.transport);
      await this.transport.connect();
      return;
    }

    // Create a transport from options or autodiscover
    if (this.options.address || this.options.portRef || this.options.transport) {
      this.transport = await createTransport(this.options);
    } else {
      // Autodiscover
      const devices = await (this.constructor as typeof LoupedeckDevice).list();
      if (devices.length > 0) {
        const desc = devices[0];
        this.transport = await createTransport({
          address: desc.address,
          portRef: desc.portRef,
          transport: desc.transport
        });
      }
    }

    if (!this.transport) {
      const err = new Error('No devices found');
      this.emit('disconnect', err);
      throw err;
    }

    this.wireTransport(this.transport);
    await this.transport.connect();
  }

  close(): Promise<void> | void {
    this.cancelReconnect();
    if (!this.transport) return;
    return this.transport.close();
  }

  /** Connect, swallowing errors (for auto-connect / reconnect). */
  private connectBlind(): void {
    this.connect().catch(() => {
      /* swallow */
    });
  }

  private wireTransport(transport: Transport): void {
    transport.on('state-change', (state: ConnectionState) => {
      if (state === 'connected') {
        this.emit('connect', { address: this.options.address ?? 'unknown' });
      }
      if (state === 'disconnected') {
        this.onDisconnect();
      }
      this.emit('state-change', state, this.connectionState);
    });
    transport.on('message', this.onReceive.bind(this));
    transport.on('error', (err: Error) => {
      this.emit('disconnect', err);
    });
  }

  private onDisconnect(error?: Error): void {
    this.emit('disconnect', error);
    this.transactions.rejectAll(new Error('Device disconnected'));
    this.cancelReconnect();
    this.transport = null;

    if (!error) return;
    if (this.reconnectInterval > 0) {
      this._reconnectTimer = setTimeout(() => this.connectBlind(), this.reconnectInterval);
    }
  }

  private cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  // ─── Protocol ───────────────────────────────────────────────

  private onReceive(buff: Buffer): void {
    const { command, transactionId, payload } = decodeMessage(buff);
    const handler = this.handlers[command];
    const response = handler ? handler(payload) : buff;
    this.transactions.resolve(transactionId, response);
  }

  /** Send a command and return a promise for the device's response. */
  send(command: number, data: Buffer = Buffer.alloc(0), timeoutMs?: number): Promise<unknown> | undefined {
    if (!this.transport?.isReady()) return undefined;
    const { transactionId, promise } = this.transactions.allocate(timeoutMs);
    const packet = encodeCommand(command as CommandValue, transactionId, data);
    this.transport.send(packet);
    return promise;
  }

  // ─── Input event handlers ──────────────────────────────────

  protected onButton(buff: Buffer): void {
    if (buff.length < 2) return;
    const id = BUTTONS[buff[0]];
    const event = buff[1] === 0x00 ? 'down' : 'up';
    this.emit(event, { id });
  }

  protected onRotate(buff: Buffer): void {
    const id = BUTTONS[buff[0]] as string;
    const delta = buff.readInt8(1);
    this.emit('rotate', { id, delta });
  }

  protected onTouch(event: 'touchstart' | 'touchmove' | 'touchend', buff: Buffer): void {
    const x = buff.readUInt16BE(1);
    const y = buff.readUInt16BE(3);
    const id = buff[5];
    const touch: Touch = { x, y, id, target: this.getTarget(x, y, id) };

    if (event === 'touchend') {
      delete this.touches[touch.id];
    } else {
      if (!this.touches[touch.id]) event = 'touchstart';
      this.touches[touch.id] = touch;
    }

    this.emit(event, {
      touches: Object.values(this.touches),
      changedTouches: [touch]
    });
  }

  /** Override in subclasses to determine which screen/key a touch targets. */
  abstract getTarget(x: number, y: number, id: number): TouchTarget;

  // ─── Drawing ────────────────────────────────────────────────

  /** Draw a raw RGB565 buffer to a display region. */
  async drawBuffer(
    { id, width, height, x = 0, y = 0, autoRefresh = true }: DrawOptions,
    buffer: Buffer
  ): Promise<void> {
    const displayInfo = this.displays[id];

    if (!displayInfo) throw new Error(`Display '${id}' is not available on this device!`);
    const { width: dw, height: dh } = displayInfo;
    width ??= dw;
    height ??= dh;
    if (displayInfo.offset) {
      x += displayInfo.offset[0];
      y += displayInfo.offset[1];
    }

    const expectedLen = width * height * 2;
    if (buffer.length !== expectedLen) {
      throw new Error(`Expected buffer length of ${expectedLen}, got ${buffer.length}!`);
    }

    const header = Buffer.alloc(8);
    header.writeUInt16BE(x, 0);
    header.writeUInt16BE(y, 2);
    header.writeUInt16BE(width, 4);
    header.writeUInt16BE(height, 6);

    await this.send(COMMANDS.FRAMEBUFF, Buffer.concat([displayInfo.id, header, buffer]));
    if (autoRefresh) await this.refresh(id);
  }

  /** Draw to a specific key index with an RGB565 buffer. */
  drawKey(index: number, buffer: Buffer): Promise<void> {
    if (index < 0 || index >= this.columns * this.rows) {
      throw new Error(`Key ${index} is not a valid key`);
    }
    const width = this.keySize;
    const height = this.keySize;
    const x = this.visibleX[0] + (index % this.columns) * width;
    const y = Math.floor(index / this.columns) * height;
    return this.drawBuffer({ id: 'center', x, y, width, height }, buffer);
  }

  /** Draw to a full screen with an RGB565 buffer. */
  drawScreen(id: string, buffer: Buffer): Promise<void> {
    return this.drawBuffer({ id }, buffer);
  }

  /** Refresh (flush) a display to make drawn content visible. */
  refresh(id: string): Promise<unknown> | undefined {
    const displayInfo = this.displays[id];
    return this.send(COMMANDS.DRAW, displayInfo.id);
  }

  // ─── Device commands ────────────────────────────────────────

  async getInfo(): Promise<{ serial: string; version: string }> {
    if (!this.transport?.isReady()) {
      throw new Error('Not connected!');
    }
    return {
      serial: (await this.send(COMMANDS.SERIAL)) as string,
      version: (await this.send(COMMANDS.VERSION)) as string
    };
  }

  setBrightness(value: number): Promise<unknown> | undefined {
    const byte = Math.max(0, Math.min(MAX_BRIGHTNESS, Math.round(value * MAX_BRIGHTNESS)));
    return this.send(COMMANDS.SET_BRIGHTNESS, Buffer.from([byte]));
  }

  setButtonColor({ id, color }: { id: number | string; color: string }): Promise<unknown> | undefined {
    const key = Object.keys(BUTTONS).find((k) => BUTTONS[Number(k)] === id);
    if (!key) throw new Error(`Invalid button ID: ${id}`);

    const [r, g, b] = parseHexColor(color);
    const data = Buffer.from([Number(key), r, g, b]);
    return this.send(COMMANDS.SET_COLOR, data);
  }

  vibrate(pattern: HapticPattern = HAPTIC.SHORT): Promise<unknown> | undefined {
    return this.send(COMMANDS.SET_VIBRATION, Buffer.from([pattern]));
  }
}
