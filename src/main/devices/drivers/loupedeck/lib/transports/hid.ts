import { VENDOR_IDS, WS_UPGRADE_HEADER, WS_UPGRADE_RESPONSE, SERIAL_MAGIC_BYTE } from '../constants';
import { frameForSerial } from '../protocol/commands';
import { MagicByteLengthParser } from '../protocol/parser';
import type { TransportType, DiscoveredDevice } from '../types';
import type { HID, Device } from 'node-hid';
import type * as NodeHID from 'node-hid';
import { BaseTransport } from './transport';

/** Timeout for the HID handshake */
const HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * HID output report size for Loupedeck / Razer devices.
 *
 * Unlike serial (which is stream-oriented), HID is packet-oriented:
 * every write must be exactly this many bytes (plus one leading byte
 * for the report ID on platforms that require it).  Data shorter than
 * this is zero-padded; data longer is split into multiple reports.
 *
 * Loupedeck devices expose a 1024-byte vendor-defined output report.
 */
const HID_REPORT_SIZE = 1024;

/**
 * Vendor-defined HID usage page range (0xFF00–0xFFFF).
 * Loupedeck / Razer protocol runs on a vendor-specific usage page,
 * typically 0xFF00. This is the reliable way to identify the correct
 * HID interface across platforms — the `interface` number from node-hid
 * is not stable on Linux (hidraw backend).
 */
const VENDOR_USAGE_PAGE_MIN = 0xff00;
const VENDOR_USAGE_PAGE_MAX = 0xffff;

/**
 * Check whether a device descriptor indicates a vendor-specific HID
 * usage page (0xFF00–0xFFFF).  Returns `false` for standard pages
 * (keyboard, consumer, etc.) and `null` when the page is unknown.
 */
function vendorUsagePageMatch(d: Device): boolean | null {
  if (d.usagePage == null || d.usagePage === 0) return null; // unknown
  return d.usagePage >= VENDOR_USAGE_PAGE_MIN && d.usagePage <= VENDOR_USAGE_PAGE_MAX;
}

/**
 * Create a stable identity key for a physical device so we can
 * pick the best HID interface per device.
 */
function physicalDeviceKey(d: Device): string {
  if (d.serialNumber) return `${d.vendorId}:${d.productId}:${d.serialNumber}`;
  // Without a serial number we can't reliably group, so treat each path
  // as its own device.
  return `path:${d.path}`;
}

/**
 * HID transport for Loupedeck / Razer devices.
 *
 * Uses node-hid to communicate with devices over USB HID. This is the
 * primary transport on Linux where serial port enumeration is unreliable
 * for these devices.
 *
 * The protocol is identical to the serial transport (WS upgrade handshake
 * + 0x82 framed messages) — only the underlying I/O mechanism differs.
 */
export class HIDTransport extends BaseTransport {
  readonly type: TransportType = 'hid';
  private device: HID | null = null;
  private parser: MagicByteLengthParser | null = null;
  private readonly hidPath: string;
  private hidModule: typeof NodeHID | null = null;

  constructor(hidPath: string) {
    super();
    this.hidPath = hidPath;
  }

  /**
   * Write a buffer to the HID device, splitting into report-sized
   * packets and zero-padding the last one.
   *
   * The first byte of each packet is the HID report ID.  For devices
   * that use a single (default) report this is `0x00`; hidapi on
   * Linux strips it before handing the rest to the kernel.
   */
  private writeHid(data: Buffer): void {
    if (!this.device) throw new Error('HID device is not open');

    for (let offset = 0; offset < data.length; offset += HID_REPORT_SIZE) {
      const chunk = data.subarray(offset, offset + HID_REPORT_SIZE);
      // Allocate report-ID (1 byte) + report payload (HID_REPORT_SIZE bytes)
      const report = Buffer.alloc(HID_REPORT_SIZE + 1, 0);
      report[0] = 0x00; // Report ID
      chunk.copy(report, 1);
      this.device.write([...report]);
    }
  }

  /** Lazy-load node-hid to avoid hard dependency if not needed */
  private async loadHid(): Promise<typeof NodeHID> {
    if (this.hidModule) return this.hidModule;
    try {
      this.hidModule = await import('node-hid');
      return this.hidModule;
    } catch {
      throw new Error('HID transport requires the `node-hid` package. Install it with `npm install node-hid`.');
    }
  }

  /**
   * Scan USB HID devices for Loupedeck / Razer controllers.
   *
   * The same physical device exposes multiple HID interfaces (keyboard,
   * consumer control, vendor-specific protocol, etc.).  Only the
   * vendor-specific interface (usagePage 0xFF00–0xFFFF) supports the
   * Loupedeck WS-over-HID protocol.  We prefer those, but when
   * usagePage is not reported we keep candidates as a fallback and
   * let the connection attempt sort it out.
   */
  static async discover(): Promise<DiscoveredDevice[]> {
    let hid: typeof NodeHID;
    try {
      hid = await import('node-hid');
    } catch {
      // node-hid not installed — no HID devices available
      return [];
    }

    // Group candidate HID paths per physical device so we can pick the
    // best interface for each one.
    const deviceCandidates = new Map<string, { preferred: Device[]; unknown: Device[] }>();

    for (const d of hid.devices()) {
      if (!VENDOR_IDS.includes(d.vendorId as (typeof VENDOR_IDS)[number])) continue;
      if (!d.path) continue;

      const match = vendorUsagePageMatch(d);
      if (match === false) continue; // known non-vendor page — skip

      const key = physicalDeviceKey(d);
      let bucket = deviceCandidates.get(key);
      if (!bucket) {
        bucket = { preferred: [], unknown: [] };
        deviceCandidates.set(key, bucket);
      }

      if (match === true) {
        bucket.preferred.push(d);
      } else {
        bucket.unknown.push(d);
      }
    }

    const results: DiscoveredDevice[] = [];
    const seen = new Set<string>();

    for (const { preferred, unknown } of deviceCandidates.values()) {
      // Take the first vendor-specific interface if available, otherwise
      // fall back to the first unknown (will be validated at connect time).
      const pick = preferred[0] ?? unknown[0];
      if (!pick?.path || seen.has(pick.path)) continue;
      seen.add(pick.path);

      results.push({
        transport: 'hid',
        productId: pick.productId,
        vendorId: pick.vendorId,
        serialNumber: pick.serialNumber,
        address: pick.path
      });
    }
    return results;
  }

  protected async _connect(): Promise<void> {
    const hid = await this.loadHid();
    try {
      this.device = new hid.HID(this.hidPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission denied') || msg.includes('EACCES') || msg.includes('read-only')) {
        throw new Error(
          `Cannot open HID device at ${this.hidPath}: permission denied. ` +
            'On Linux, ensure udev rules are installed and reloaded:\n' +
            '  sudo udevadm control --reload-rules && sudo udevadm trigger\n' +
            'Then unplug and re-plug the device, or reboot.'
        );
      }
      throw err;
    }

    // HID devices emit raw data buffers via 'data' events
    this.device.resume();

    // ─── Handshake ────────────────────────────────────────────
    this.setState('handshaking');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`HID handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
      }, HANDSHAKE_TIMEOUT_MS);

      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.includes(WS_UPGRADE_RESPONSE)) {
          clearTimeout(timeout);
          this.device!.removeAllListeners();
          resolve();
        }
      };
      this.device!.on('data', onData);
      this.device!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      // Send upgrade request as a padded HID report
      const upgradeBytes = Buffer.from(WS_UPGRADE_HEADER);
      try {
        this.writeHid(upgradeBytes);
      } catch (writeErr: unknown) {
        clearTimeout(timeout);
        const wmsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        // Detect permission-related errors: explicit permission errors, write failures, or device busy
        const isPermissionError = wmsg.toLowerCase().includes('permission') || 
                                 wmsg.toLowerCase().includes('access') ||
                                 wmsg.toLowerCase().includes('busy') ||
                                 wmsg.toLowerCase().includes('cannot write') ||
                                 wmsg.toLowerCase().includes('eacces');
        
        reject(
          new Error(
            `Cannot write to HID device at ${this.hidPath} (${wmsg}). ` +
            (isPermissionError 
              ? 'This is usually a permission issue. On Linux, ensure udev rules are installed and reloaded:\n' +
                '  sudo udevadm control --reload-rules && sudo udevadm trigger\n' +
                'Then unplug and re-plug the device, or reboot.'
              : 'The device may require different report parameters. ' +
                'Please file a bug with the output of: ' +
                'node -e "require(\'node-hid\').devices().forEach(d=>console.log(JSON.stringify(d)))"'
            )
          )
        );
      }
    });

    // ─── Data pipeline ────────────────────────────────────────
    this.parser = new MagicByteLengthParser({ magicByte: SERIAL_MAGIC_BYTE });
    this.parser.on('data', (data: Buffer) => {
      this.emit('message', data);
    });

    this.device.on('data', (data: Buffer) => {
      this.parser!.write(data);
    });

    this.device.on('error', this.onError.bind(this));

    this.setState('connected');
  }

  protected async _close(): Promise<void> {
    this.cleanup();
  }

  protected _send(data: Buffer): void {
    if (!this.device) return;
    const framed = frameForSerial(data);
    this.writeHid(framed);
  }

  private onError(err: Error): void {
    this.emit('error', err);
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
    if (this.device) {
      try {
        this.device.removeAllListeners();
        this.device.close();
      } catch {
        // Device may already be gone
      }
      this.device = null;
    }
  }
}
