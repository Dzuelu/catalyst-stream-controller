/**
 * Linux hybrid serial+HID transport for Loupedeck / Razer devices.
 *
 * On Linux, some device firmware requires the HID interface
 * (`/dev/hidrawX`) to be **opened** before button/knob input events
 * are delivered on the serial channel.  The HID device is not read
 * from — all I/O flows through serial, identical to macOS/Windows.
 *
 * This transport extends {@link SerialTransport} with a single
 * addition: it opens the companion HID device on connect and closes
 * it on disconnect.  No data listeners are attached to HID.
 */

import type { HID } from 'node-hid';
import type * as NodeHID from 'node-hid';

import { SerialTransport } from './serial';

export class LinuxHybridTransport extends SerialTransport {
  private hidDevice: HID | null = null;
  private readonly hidPath: string;

  constructor(serialPath: string, hidPath: string) {
    super(serialPath);
    this.hidPath = hidPath;
  }

  protected override async _connect(): Promise<void> {
    // Open the HID device first — this "unlocks" serial input on
    // some firmware.  We don't listen for data; serial carries everything.
    try {
      const hid: typeof NodeHID = await import('node-hid');
      this.hidDevice = new hid.HID(this.hidPath);
      this.hidDevice.on('error', (err: Error) => {
        console.warn('[LinuxHybridTransport] HID device error (non-fatal):', err.message);
        this.cleanupHid();
      });
      console.log(`[LinuxHybridTransport] Opened HID device ${this.hidPath} to enable serial input`);
    } catch (err) {
      console.warn(
        `[LinuxHybridTransport] Could not open HID device ${this.hidPath}:`,
        err instanceof Error ? err.message : err
      );
    }

    // All actual I/O goes through serial
    await super._connect();
  }

  protected override async _close(): Promise<void> {
    await super._close();
    this.cleanupHid();
  }

  private cleanupHid(): void {
    if (this.hidDevice) {
      try {
        this.hidDevice.removeAllListeners();
        this.hidDevice.close();
      } catch {
        /* device may already be gone */
      }
      this.hidDevice = null;
    }
  }
}
