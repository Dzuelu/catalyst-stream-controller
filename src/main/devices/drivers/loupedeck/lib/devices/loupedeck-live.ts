import type { DisplayInfo, TouchTarget, DeviceOptions } from '../types';

import { LoupedeckDevice } from './base';

/**
 * Loupedeck Live — 4×3 key grid with left/right side strips and 6 knobs.
 *
 * Firmware V0.2.X uses serial; V0.1.X uses websocket.
 * All three display regions (left, center, right) are addressed as a
 * single framebuffer with pixel offsets.
 */
export class LoupedeckLive extends LoupedeckDevice {
  static override productId = 0x0004;
  static override vendorId = 0x2ec2;

  readonly type: string = 'Loupedeck Live';
  readonly buttons: readonly (number | string)[] = [0, 1, 2, 3, 4, 5, 6, 7];
  readonly knobs: readonly string[] = ['knobCL', 'knobCR', 'knobTL', 'knobTR', 'knobBL', 'knobBR'];
  readonly columns = 4;
  readonly rows = 3;
  readonly visibleX: [number, number] = [0, 480];

  readonly displays: Record<string, DisplayInfo> = {
    center: { id: Buffer.from('\x00M'), width: 360, height: 270, offset: [60, 0] },
    left: { id: Buffer.from('\x00M'), width: 60, height: 270 },
    right: { id: Buffer.from('\x00M'), width: 60, height: 270, offset: [420, 0] }
  };

  constructor(options?: DeviceOptions) {
    super(options);
  }

  getTarget(x: number, y: number, _id?: number): TouchTarget {
    if (x < this.displays.left.width) return { screen: 'left' };
    if (x >= this.displays.left.width + this.displays.center.width) return { screen: 'right' };
    const column = Math.floor((x - this.displays.left.width) / this.keySize);
    const row = Math.floor(y / this.keySize);
    const key = row * this.columns + column;
    return { screen: 'center', key };
  }
}
