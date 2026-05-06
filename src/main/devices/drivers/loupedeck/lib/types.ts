// ─── Transport Types ────────────────────────────────────────────

/** Supported transport mechanisms */
export type TransportType = 'serial' | 'hid' | 'websocket' | 'web-serial';

/** Connection lifecycle states */
export type ConnectionState = 'disconnected' | 'connecting' | 'handshaking' | 'connected' | 'disconnecting';

/** Events emitted by a Transport */
export interface TransportEvents {
  'state-change': (state: ConnectionState, previousState: ConnectionState) => void;
  message: (data: Buffer) => void;
  error: (error: Error) => void;
}

/** A transport that can connect/disconnect and send/receive raw buffers */
export interface Transport {
  readonly type: TransportType;
  readonly state: ConnectionState;
  connect(): Promise<void>;
  close(): Promise<void>;
  send(data: Buffer): void;
  isReady(): boolean;
  on<E extends keyof TransportEvents>(event: E, handler: TransportEvents[E]): void;
  off<E extends keyof TransportEvents>(event: E, handler: TransportEvents[E]): void;
  removeAllListeners(): void;
}

/** Result returned by a transport's static discover() method */
export interface DiscoveredDevice {
  transport: TransportType;
  productId: number;
  vendorId: number;
  serialNumber?: string;
  /** Transport-specific connection address (serial path, HID path, or WebSocket host) */
  address?: string;
  /** Opaque port reference for Web Serial (browser SerialPort object) */
  portRef?: unknown;
  /** Companion HID device path — on Linux, opening HID is required to enable serial input on some firmware */
  hidAddress?: string;
}

// ─── Device Types ───────────────────────────────────────────────

/** Display descriptor for a device screen region */
export interface DisplayInfo {
  /** Two-byte display identifier sent to firmware */
  id: Buffer;
  width: number;
  height: number;
  /** Pixel offset [x, y] within the framebuffer */
  offset?: [number, number];
  /** Byte order — defaults to 'le' */
  endianness?: 'le' | 'be';
}

/** Touch point emitted by touch events */
export interface Touch {
  x: number;
  y: number;
  id: number;
  target: TouchTarget;
}

/** Describes what screen region a touch landed on */
export interface TouchTarget {
  screen?: string;
  key?: number;
}

/** Events emitted by a LoupedeckDevice */
export interface DeviceEvents {
  connect: (info: { address: string }) => void;
  disconnect: (error?: Error) => void;
  down: (data: { id: number | string }) => void;
  up: (data: { id: number | string }) => void;
  rotate: (data: { id: string; delta: number }) => void;
  touchstart: (data: { touches: Touch[]; changedTouches: Touch[] }) => void;
  touchmove: (data: { touches: Touch[]; changedTouches: Touch[] }) => void;
  touchend: (data: { touches: Touch[]; changedTouches: Touch[] }) => void;
  'state-change': (state: ConnectionState, previousState: ConnectionState) => void;
}

/** Options when constructing a device */
export interface DeviceOptions {
  /** Transport-specific connection address (serial path, HID path, or WebSocket host) */
  address?: string;
  /** Opaque port reference for Web Serial (browser SerialPort object) */
  portRef?: unknown;
  /** Milliseconds between reconnect attempts (0 = disable). Default: 0 */
  reconnectInterval?: number;
  /** Preferred transport type (overrides auto-detection) */
  transport?: TransportType;
  /** Companion HID device path — on Linux, opening HID is required to enable serial input on some firmware */
  hidAddress?: string;
}

/**
 * Options for device discovery / listing.
 *
 * By default each transport is enabled and the platform determines the
 * priority order used when deduplicating (Linux → HID first, others →
 * serial first).
 */
export interface DiscoveryOptions {
  /** Skip serial port scanning (default: false) */
  ignoreSerial?: boolean;
  /** Skip WebSocket scanning (default: false) */
  ignoreWebsocket?: boolean;
  /** Skip HID scanning (default: false) */
  ignoreHid?: boolean;
  /**
   * Explicit transport priority order.  The first transport wins when
   * the same physical device is found on multiple transports.
   *
   * Default: `['hid', 'serial', 'websocket']` on Linux,
   *          `['serial', 'hid', 'websocket']` on macOS/Windows.
   */
  transportPriority?: readonly TransportType[];
}

/** Describes a device discovered by listDevices() — can be used to connect */
export interface DeviceDescriptor extends DiscoveredDevice {
  /** Human-readable device model name */
  type: string;
  /** Instantiate and connect to this device */
  connect(options?: Partial<DeviceOptions>): Promise<LoupedeckDeviceLike>;
  /**
   * Alternative transports that can reach the same physical device,
   * ordered by priority (best-first).  If `connect()` fails the
   * caller can try these in order.
   */
  fallbackTransports?: ReadonlyArray<{ transport: TransportType; address?: string; portRef?: unknown }>;
}

/** Minimal device interface for the descriptor's connect() return type */
export interface LoupedeckDeviceLike {
  readonly type: string;
  readonly columns: number;
  readonly rows: number;
  readonly keySize: number;
  readonly visibleX: readonly number[];
  readonly displays: Record<string, DisplayInfo>;
  close(): Promise<void> | void;
  drawBuffer(options: DrawOptions, buffer: Buffer): Promise<void>;
  on<E extends keyof DeviceEvents>(event: E, handler: DeviceEvents[E]): void;
}

/** Canvas drawing callback signature (uses `unknown` to avoid hard dep on DOM/canvas types) */
export type DrawCallback = (ctx: unknown, width: number, height: number) => void;

/** Draw options for buffer/canvas operations */
export interface DrawOptions {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  autoRefresh?: boolean;
}
