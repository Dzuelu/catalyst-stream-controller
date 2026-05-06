import { SERIAL_MAGIC_BYTE, WS_UPGRADE_HEADER, WS_UPGRADE_RESPONSE } from '../constants';
import { frameForSerial } from '../protocol/commands';
import type { TransportType, DiscoveredDevice } from '../types';

import { BaseTransport } from './transport';

// ─── Browser-side MagicByteLengthParser (TransformStream) ─────

/** Frame parse statistics (browser-side mirror of the Node parser). */
interface BrowserParserStats {
  framesEmitted: number;
  bytesDropped: number;
  incompleteFlushes: number;
}

class MagicByteLengthParserWeb {
  private buffer = Buffer.alloc(0);
  private readonly delimiter: number;
  readonly stats: BrowserParserStats = { framesEmitted: 0, bytesDropped: 0, incompleteFlushes: 0 };

  constructor(magicByte: number) {
    this.delimiter = magicByte;
  }

  transform(chunk: Buffer, controller: TransformStreamDefaultController<Buffer>): void {
    let data = Buffer.concat([this.buffer, chunk]);
    let position: number;
    while ((position = data.indexOf(this.delimiter)) !== -1) {
      // Drop bytes before the magic byte
      if (position > 0) {
        this.stats.bytesDropped += position;
        data = data.subarray(position);
      }
      if (data.length < 2) break;
      const nextLength = data[1];
      const expectedEnd = nextLength + 2;
      if (data.length < expectedEnd) break;
      controller.enqueue(data.subarray(2, expectedEnd));
      this.stats.framesEmitted++;
      data = data.subarray(expectedEnd);
    }
    this.buffer = data;
  }

  flush(_controller: TransformStreamDefaultController<Buffer>): void {
    if (this.buffer.length > 0) {
      // Incomplete frame at stream end — drop it
      this.stats.bytesDropped += this.buffer.length;
      this.stats.incompleteFlushes++;
      // Do NOT enqueue incomplete frames
    }
  }
}

/** Async generator that reads from a Web Serial port through the parser */
async function* readParsed(port: SerialPort, signal: AbortSignal): AsyncGenerator<Buffer> {
  const transformer = new TransformStream(new MagicByteLengthParserWeb(SERIAL_MAGIC_BYTE));
  const transformed = port.readable!.pipeThrough(transformer, { signal });
  const reader = transformed.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.error('[WebSerialTransport] Read error:', error);
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Vendor IDs for Web Serial filter ─────────────────────────
const USB_FILTERS = [{ usbVendorId: 0x2ec2 }, { usbVendorId: 0x1532 }];

/**
 * Web Serial API transport (browser environment).
 *
 * Uses the same protocol as SerialTransport but over the browser's
 * Web Serial API instead of the Node.js `serialport` package.
 */
export class WebSerialTransport extends BaseTransport {
  readonly type: TransportType = 'web-serial';
  private port: SerialPort;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readStream: AsyncGenerator<Buffer> | null = null;
  private aborter: AbortController | null = null;

  constructor(port: SerialPort) {
    super();
    this.port = port;
    // Listen for browser disconnect events
    navigator.serial.addEventListener('disconnect', this.onDisconnect.bind(this));
  }

  /**
   * Discover devices via the Web Serial API.
   * Returns already-authorized ports, or prompts the user to select one.
   */
  static async discover(): Promise<DiscoveredDevice[]> {
    if (!navigator.serial) return [];

    const ports = await navigator.serial.getPorts();
    if (!ports.length) {
      try {
        ports.push(await navigator.serial.requestPort({ filters: USB_FILTERS }));
      } catch {
        // User cancelled the prompt
        return [];
      }
    }

    const results: DiscoveredDevice[] = [];
    for (const port of ports) {
      const info = port.getInfo();
      results.push({
        transport: 'web-serial',
        portRef: port,
        productId: info.usbProductId ?? 0,
        vendorId: info.usbVendorId ?? 0
      });
    }
    return results;
  }

  protected async _connect(): Promise<void> {
    if (!this.port.readable) {
      await this.port.open({ baudRate: 256000 });
    }

    const reader = this.port.readable!.getReader();
    this.writer = this.port.writable!.getWriter();

    // ─── Handshake ──────────────────────────────────────────
    this.setState('handshaking');

    const nextMessage = reader.read();
    await this.writer.write(Buffer.from(WS_UPGRADE_HEADER));
    const { value: response } = await nextMessage;
    const text = new TextDecoder().decode(response);
    if (!text.startsWith(WS_UPGRADE_RESPONSE)) {
      reader.releaseLock();
      throw new Error(`Invalid handshake response: ${text}`);
    }
    reader.releaseLock();

    // ─── Data pipeline ──────────────────────────────────────
    this.aborter = new AbortController();
    this.readStream = readParsed(this.port, this.aborter.signal);

    this.setState('connected');

    // Start reading in the background
    void this.backgroundRead();
  }

  protected async _close(): Promise<void> {
    if (this.aborter) {
      this.aborter.abort('Manual close');
    }
    // Wait for read loop to end
    if (this.readStream) {
      // Drain the generator
      try {
        for await (const _ of this.readStream) {
          break;
        }
      } catch {
        // Expected
      }
      this.readStream = null;
    }
    if (this.writer) {
      try {
        void this.writer.close();
        this.writer.releaseLock();
      } catch {
        // May already be released
      }
      this.writer = null;
    }
    // Wait a tick for pipeThrough() to release the readable lock
    await new Promise((r) => setTimeout(r, 10));
    try {
      await this.port.close();
    } catch {
      // Port may already be closed
    }
  }

  protected _send(data: Buffer): void {
    if (!this.writer) return;
    const framed = frameForSerial(data);
    void this.writer.write(framed);
  }

  private async backgroundRead(): Promise<void> {
    if (!this.readStream) return;
    for await (const message of this.readStream) {
      if (!this.port.readable) break;
      this.emit('message', message);
    }
  }

  private onDisconnect(): void {
    this.emit('error', new Error('Web Serial device disconnected'));
    try {
      this.setState('disconnected');
    } catch {
      // Already disconnected
    }
  }
}
