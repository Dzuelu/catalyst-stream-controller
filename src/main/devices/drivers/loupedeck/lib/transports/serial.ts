import { SerialPort } from 'serialport';

import {
  VENDOR_IDS,
  MANUFACTURERS,
  WS_UPGRADE_HEADER,
  WS_UPGRADE_RESPONSE,
  WS_CLOSE_FRAME,
  SERIAL_MAGIC_BYTE
} from '../constants';
import { frameForSerial } from '../protocol/commands';
import { MagicByteLengthParser } from '../protocol/parser';
import type { TransportType, DiscoveredDevice } from '../types';

import { BaseTransport } from './transport';

/** Timeout for the serial "websocket" handshake */
const HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * Node.js serial port transport.
 *
 * The Loupedeck firmware uses a quirky protocol where the serial
 * connection starts with an HTTP-style WebSocket upgrade handshake,
 * then frames all messages with 0x82 magic bytes.
 */
export class SerialTransport extends BaseTransport {
  readonly type: TransportType = 'serial';
  private connection: SerialPort | null = null;
  private parser: MagicByteLengthParser | null = null;
  private readonly path: string;

  constructor(path: string) {
    super();
    this.path = path;
  }

  /**
   * Scan serial ports for Loupedeck / Razer devices.
   */
  static async discover(): Promise<DiscoveredDevice[]> {
    const results: DiscoveredDevice[] = [];
    for (const info of await SerialPort.list()) {
      const vendorId = parseInt(info.vendorId ?? '0', 16);
      const productId = parseInt(info.productId ?? '0', 16);
      const matchesVendor = VENDOR_IDS.includes(vendorId as (typeof VENDOR_IDS)[number]);
      const matchesMfg = MANUFACTURERS.includes(info.manufacturer as (typeof MANUFACTURERS)[number]);
      if (!matchesVendor && !matchesMfg) continue;
      results.push({
        transport: 'serial',
        address: info.path,
        vendorId,
        productId,
        serialNumber: info.serialNumber
      });
    }
    return results;
  }

  protected async _connect(): Promise<void> {
    this.connection = new SerialPort({ path: this.path, baudRate: 256000 });

    // Wait for port open
    await new Promise<void>((resolve, reject) => {
      this.connection!.once('open', resolve);
      this.connection!.once('error', reject);
    });

    this.connection.on('error', this.onError.bind(this));
    this.connection.on('close', this.onClose.bind(this));

    // ─── Handshake ────────────────────────────────────────────
    this.setState('handshaking');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Serial handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
      }, HANDSHAKE_TIMEOUT_MS);

      // Buffer incoming data until we see the response header
      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.includes(WS_UPGRADE_RESPONSE)) {
          clearTimeout(timeout);
          this.connection!.removeListener('data', onData);
          resolve();
        }
      };
      this.connection!.on('data', onData);

      // Send the upgrade request as raw bytes
      this.connection!.write(Buffer.from(WS_UPGRADE_HEADER));
    });

    // ─── Data pipeline ────────────────────────────────────────
    this.parser = new MagicByteLengthParser({ magicByte: SERIAL_MAGIC_BYTE });
    this.connection.pipe(this.parser);
    this.parser.on('data', (data: Buffer) => {
      this.emit('message', data);
    });

    this.setState('connected');
  }

  protected async _close(): Promise<void> {
    if (!this.connection) return;
    // Send websocket close frame
    this.connection.write(WS_CLOSE_FRAME);
    await new Promise<void>((resolve) => {
      this.connection!.close(() => resolve());
    });
    this.cleanup();
  }

  protected _send(data: Buffer): void {
    if (!this.connection) return;
    const framed = frameForSerial(data);
    this.connection.write(framed);
  }

  private onError(err: Error): void {
    this.emit('error', err);
    this.cleanup();
    // Force state to disconnected
    try {
      this.setState('disconnected');
    } catch {
      // May already be disconnected
    }
  }

  private onClose(err?: Error | null): void {
    if (err) {
      this.emit('error', err);
    }
    this.cleanup();
    try {
      this.setState('disconnected');
    } catch {
      // Already disconnected
    }
  }

  private cleanup(): void {
    if (this.parser) {
      this.parser.removeAllListeners();
      this.parser = null;
    }
    if (this.connection) {
      this.connection.removeAllListeners();
      this.connection = null;
    }
  }
}
